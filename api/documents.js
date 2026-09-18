/* =========================================================
   DOCUMENT API
   ---------------------------------------------------------
   Public:
     GET /api/documents
     GET /api/documents?id=DOCUMENT_ID&mode=preview
     GET /api/documents?id=DOCUMENT_ID&mode=download

   IMPORTANT:
     SUPABASE_SECRET_KEY must ONLY exist on the server.
========================================================= */

import { createClient } from "@supabase/supabase-js";

/* =========================================================
   SUPABASE SERVER CLIENT
========================================================= */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

function getAdminClient() {
    if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
        throw new Error("Supabase server configuration is missing.");
    }

    return createClient(
        SUPABASE_URL,
        SUPABASE_SECRET_KEY,
        {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        }
    );
}

/* =========================================================
   CORS / SECURITY HEADERS
========================================================= */

function setHeaders(res) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("CDN-Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Access-Control-Allow-Origin", "*");
}

/* =========================================================
   GET DOCUMENT LIST
========================================================= */

async function listDocuments(supabase) {
    const { data, error } = await supabase
        .from("documents")
        .select("id,title,type,download_allowed,created_at")
        .order("created_at", { ascending: false });

    if (error) {
        throw error;
    }

    return (data || []).map(document => ({
        id: document.id,
        title: document.title,
        type: document.type,
        preview: true,
        download: Boolean(document.download_allowed),
        createdAt: document.created_at
    }));
}

/* =========================================================
   GET SINGLE DOCUMENT
========================================================= */

async function getDocument(supabase, id, mode) {
    if (!id) {
        const error = new Error("Document ID is required.");
        error.statusCode = 400;
        throw error;
    }

    if (mode !== "preview" && mode !== "download") {
        const error = new Error("Invalid document mode.");
        error.statusCode = 400;
        throw error;
    }

    const { data: document, error } = await supabase
        .from("documents")
        .select("id,title,type,storage_path,download_allowed")
        .eq("id", id)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (!document) {
        const notFound = new Error("Document not found.");
        notFound.statusCode = 404;
        throw notFound;
    }

    if (mode === "download" && !document.download_allowed) {
        const forbidden = new Error("Downloads are disabled for this document.");
        forbidden.statusCode = 403;
        throw forbidden;
    }

    const { data: signed, error: signError } = await supabase
        .storage
        .from("documents")
        .createSignedUrl(
            document.storage_path,
            600,
            mode === "download" ? { download: true } : undefined
        );

    if (signError) {
        throw signError;
    }

    if (!signed?.signedUrl) {
        throw new Error("Unable to create document URL.");
    }

    return {
        url: signed.signedUrl
    };
}

/* =========================================================
   MAIN VERCEL HANDLER
========================================================= */

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
            const documents = await listDocuments(supabase);
            return res.status(200).json(documents);
        }

        const document = await getDocument(supabase, id, mode || "preview");
        
        return res.redirect(307, document.url);

    } catch (error) {
        console.error("Document API error:", error);

        const status = Number(error.statusCode) >= 400 ? error.statusCode : 500;
        return res.status(status).json({
            error: status === 500 ? "Document service error." : error.message
        });
    }
}
