/* =========================================================
   PUBLIC DOCUMENT API
   ---------------------------------------------------------
   This endpoint is optional for the document room. It uses
   server-side Supabase credentials and NEVER exposes them.

   Access modes:
     preview  -> guests may preview only
     download -> guests may download only
     private  -> admins only
========================================================= */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

function getAdminClient() {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        const error = new Error(
            "Supabase server environment variables are missing. Add SUPABASE_URL and SUPABASE_SECRET_KEY in Vercel, then redeploy."
        );
        error.statusCode = 500;
        throw error;
    }

    return createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    });
}

function setHeaders(res) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("CDN-Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Access-Control-Allow-Origin", "*");
}

async function listDocuments(supabase) {
    const { data, error } = await supabase
        .from("documents")
        .select("id,title,type,access_mode,created_at")
        .in("access_mode", ["preview", "download"])
        .order("created_at", { ascending: false });

    if (error) throw error;

    return (data || []).map(document => ({
        id: document.id,
        title: document.title,
        type: document.type,
        accessMode: document.access_mode,
        preview: document.access_mode === "preview",
        download: document.access_mode === "download",
        createdAt: document.created_at
    }));
}

async function getDocument(supabase, id, mode) {
    if (!id) {
        const error = new Error("Document ID is required.");
        error.statusCode = 400;
        throw error;
    }

    if (!["preview", "download"].includes(mode)) {
        const error = new Error("Invalid document mode.");
        error.statusCode = 400;
        throw error;
    }

    const { data: document, error } = await supabase
        .from("documents")
        .select("id,title,type,storage_path,access_mode")
        .eq("id", id)
        .maybeSingle();

    if (error) throw error;
    if (!document) {
        const error404 = new Error("Document not found.");
        error404.statusCode = 404;
        throw error404;
    }

    if (document.access_mode === "private") {
        const error403 = new Error("This document is private.");
        error403.statusCode = 403;
        throw error403;
    }

    if (document.access_mode !== mode) {
        const error403 = new Error(
            mode === "download"
                ? "Downloads are disabled for this document."
                : "Preview is disabled for this document."
        );
        error403.statusCode = 403;
        throw error403;
    }

    const { data: signed, error: signError } = await supabase
        .storage
        .from("documents")
        .createSignedUrl(
            document.storage_path,
            600,
            mode === "download" ? { download: true } : undefined
        );

    if (signError) throw signError;
    if (!signed?.signedUrl) throw new Error("Unable to create document URL.");

    return {
        id: document.id,
        title: document.title,
        type: document.type,
        accessMode: document.access_mode,
        mode,
        url: signed.signedUrl,
        expiresIn: 600
    };
}

export default async function handler(req, res) {
    setHeaders(res);

    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ error: "Method not allowed." });
    }

    try {
        const supabase = getAdminClient();
        const id = typeof req.query.id === "string" ? req.query.id : "";
        const mode = typeof req.query.mode === "string" ? req.query.mode : "";

        if (!id) {
            return res.status(200).json(await listDocuments(supabase));
        }

        return res.status(200).json(
            await getDocument(supabase, id, mode || "preview")
        );
    } catch (error) {
        console.error("Document API error:", error);
        const status = Number(error?.statusCode) >= 400 ? error.statusCode : 500;
        return res.status(status).json({
            error: error?.message || "Document service error."
        });
    }
}
