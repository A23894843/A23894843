/* =========================================================
   DOCUMENT API
   ---------------------------------------------------------
   Public:
     GET /api/documents
     GET /api/documents?id=DOCUMENT_ID&mode=preview
     GET /api/documents?id=DOCUMENT_ID&mode=download

   Admin:
     Admin upload/delete/update is handled through the
     authenticated Supabase client in admin/auth.js.

   IMPORTANT:
     SUPABASE_SECRET_KEY must ONLY exist on the server.
========================================================= */

import { createClient } from "@supabase/supabase-js";


/* =========================================================
   SUPABASE SERVER CLIENT
========================================================= */

const SUPABASE_URL =
    process.env.SUPABASE_URL;

const SUPABASE_SECRET_KEY =
    process.env.SUPABASE_SECRET_KEY;


/* =========================================================
   VALIDATE SERVER CONFIGURATION
========================================================= */

function getAdminClient() {

    if (
        !SUPABASE_URL ||
        !SUPABASE_SECRET_KEY
    ) {
        throw new Error(
            "Supabase server configuration is missing."
        );
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

    res.setHeader(
        "Cache-Control",
        "no-store, max-age=0"
    );

    res.setHeader(
        "CDN-Cache-Control",
        "no-store"
    );

    res.setHeader(
        "X-Content-Type-Options",
        "nosniff"
    );

    res.setHeader(
        "Referrer-Policy",
        "no-referrer"
    );

    res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
    );
}


/* =========================================================
   GET DOCUMENT LIST
========================================================= */

/*
 * Returns only metadata.
 *
 * The actual private Storage path is NOT exposed.
 */

async function listDocuments(supabase) {

    const { data, error } =
        await supabase
            .from("documents")
            .select(
                "id,title,type,download_allowed,created_at"
            )
            .order(
                "created_at",
                {
                    ascending: false
                }
            );


    if (error) {
        throw error;
    }


    return (data || []).map(document => ({

        id: document.id,

        title: document.title,

        type: document.type,

        preview: true,

        download:
            Boolean(
                document.download_allowed
            ),

        createdAt:
            document.created_at
    }));
}


/* =========================================================
   GET SINGLE DOCUMENT
========================================================= */

async function getDocument(
    supabase,
    id,
    mode
) {

    /* -----------------------------------------------------
       Validate document ID
    ----------------------------------------------------- */

    if (!id) {

        const error =
            new Error(
                "Document ID is required."
            );

        error.statusCode = 400;

        throw error;
    }


    /* -----------------------------------------------------
       Validate mode
    ----------------------------------------------------- */

    if (
        mode !== "preview" &&
        mode !== "download"
    ) {

        const error =
            new Error(
                "Invalid document mode."
            );

        error.statusCode = 400;

        throw error;
    }


    /* -----------------------------------------------------
       Fetch document metadata
    ----------------------------------------------------- */

    const { data: document, error } =
        await supabase
            .from("documents")
            .select(
                "id,title,type,storage_path,download_allowed"
            )
            .eq("id", id)
            .maybeSingle();


    if (error) {
        throw error;
    }


    if (!document) {

        const notFound =
            new Error(
                "Document not found."
            );

        notFound.statusCode = 404;

        throw notFound;
    }


    /* -----------------------------------------------------
       Enforce download permission
    ----------------------------------------------------- */

    if (
        mode === "download" &&
        !document.download_allowed
    ) {

        const forbidden =
            new Error(
                "Downloads are disabled for this document."
            );

        forbidden.statusCode = 403;

        throw forbidden;
    }


    /* -----------------------------------------------------
       Create short-lived signed URL
       -----------------------------------------------------

       10 minutes.

       The URL itself gives temporary access to the
       private Storage object.
    */

    const { data: signed, error: signError } =
        await supabase
            .storage
            .from("documents")
            .createSignedUrl(
                document.storage_path,
                600,
                mode === "download"
                    ? {
                        download: true
                    }
                    : undefined
            );


    if (signError) {
        throw signError;
    }


    if (!signed?.signedUrl) {

        throw new Error(
            "Unable to create document URL."
        );
    }


    /* -----------------------------------------------------
       Return signed URL
    ----------------------------------------------------- */

    return {
        id: document.id,

        title: document.title,

        type: document.type,

        mode,

        url: signed.signedUrl,

        expiresIn: 600
    };
}


/* =========================================================
   MAIN VERCEL HANDLER
========================================================= */

export default async function handler(
    req,
    res
) {

    setHeaders(res);


    /* -----------------------------------------------------
       Only GET is required
    ----------------------------------------------------- */

    if (req.method !== "GET") {

        res.setHeader(
            "Allow",
            "GET"
        );

        return res.status(405).json({
            error: "Method not allowed."
        });
    }


    try {

        /* -------------------------------------------------
           Create privileged server client
        ------------------------------------------------- */

        const supabase =
            getAdminClient();


        /* -------------------------------------------------
           Read query parameters
        ------------------------------------------------- */

        const id =
            typeof req.query.id === "string"
                ? req.query.id
                : "";


        const mode =
            typeof req.query.mode === "string"
                ? req.query.mode
                : "";


        /* -------------------------------------------------
           No ID → return public document list
        ------------------------------------------------- */

        if (!id) {

            const documents =
                await listDocuments(
                    supabase
                );


            return res.status(200).json(
                documents
            );
        }


        /* -------------------------------------------------
           ID supplied → return signed URL
        ------------------------------------------------- */

        const document =
            await getDocument(
                supabase,
                id,
                mode || "preview"
            );


        return res.status(200).json(
            document
        );

    }

    catch (error) {

        console.error(
            "Document API error:",
            error
        );


        const status =
            Number(error.statusCode) >= 400
                ? error.statusCode
                : 500;


        return res.status(status).json({

            error:
                status === 500
                    ? "Document service error."
                    : error.message
        });
    }
}
