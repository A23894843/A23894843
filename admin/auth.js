/* =========================================================
   SUPABASE AUTH + DOCUMENT MANAGEMENT
   ========================================================= */

let sb = null;


/* =========================================================
   MESSAGE HANDLER
   ========================================================= */

function setMessage(text, type = "error") {

    const element =
        document.getElementById("message") ||
        document.getElementById("msg");

    if (!element) {
        return;
    }

    element.textContent = text;

    element.classList.remove("success");

    if (type === "success") {
        element.classList.add("success");
        element.style.color = "var(--t)";
    } else {
        element.style.color = "var(--r)";
    }
}


/* =========================================================
   SUPABASE INITIALIZATION
   ========================================================= */

function init() {

    if (!window.supabase) {

        setMessage(
            "Supabase library could not be loaded."
        );

        return false;
    }


    if (
        typeof SUPABASE_URL === "undefined" ||
        typeof SUPABASE_ANON_KEY === "undefined" ||
        !SUPABASE_URL ||
        !SUPABASE_ANON_KEY ||
        SUPABASE_URL.includes("YOUR_")
    ) {

        setMessage(
            "Configure admin/config.js first."
        );

        return false;
    }


    if (!sb) {

        sb = window.supabase.createClient(
            SUPABASE_URL,
            SUPABASE_ANON_KEY
        );
    }


    return true;
}


/* =========================================================
   LOGIN
   ========================================================= */

async function login(email, password) {

    if (!init()) {
        return false;
    }


    try {

        const result =
            await sb.auth.signInWithPassword({
                email,
                password
            });


        if (result.error) {
            throw result.error;
        }


        const user =
            result.data.user;


        if (!user) {
            throw new Error(
                "Unable to retrieve user account."
            );
        }


        /* -----------------------------------------------
           Check admin authorization
        ------------------------------------------------ */

        const profile =
            await sb
                .from("profiles")
                .select("role,status")
                .eq("id", user.id)
                .single();


        if (profile.error) {
            throw profile.error;
        }


        if (
            profile.data.role !== "admin" ||
            profile.data.status !== "approved"
        ) {

            await sb.auth.signOut();

            throw new Error(
                "Account is pending or not authorized."
            );
        }


        window.location.href =
            "/admin/documents.html";


        return true;

    } catch (error) {

        setMessage(
            error.message ||
            "Unable to sign in."
        );

        return false;
    }
}


/* =========================================================
   SIGNUP
   ========================================================= */

async function signup(
    name,
    email,
    password,
    confirmPassword
) {

    if (!init()) {
        return false;
    }


    /* -----------------------------------------------
       Validate password
    ------------------------------------------------ */

    if (password !== confirmPassword) {

        setMessage(
            "Passwords do not match."
        );

        return false;
    }


    if (password.length < 15) {

        setMessage(
            "Use at least 15 characters."
        );

        return false;
    }


    try {

        /* -------------------------------------------
           Create Auth account
        -------------------------------------------- */

        const result =
            await sb.auth.signUp({

                email,

                password,

                options: {
                    data: {
                        display_name: name
                    }
                }
            });


        if (result.error) {
            throw result.error;
        }


        if (!result.data.user) {

            throw new Error(
                "Account could not be created."
            );
        }


        /*
         * IMPORTANT:
         *
         * We DO NOT insert into public.profiles here.
         *
         * A PostgreSQL trigger should create:
         *
         * role   = admin
         * status = pending
         *
         * automatically.
         */


        setMessage(
            "Registration submitted. Verify your email if required, then wait for admin approval.",
            "success"
        );


        /* -------------------------------------------
           Clear password fields
        -------------------------------------------- */

        const passwordInput =
            document.getElementById(
                "passwordInput"
            );

        const confirmPasswordInput =
            document.getElementById(
                "confirmPasswordInput"
            );


        if (passwordInput) {
            passwordInput.value = "";
        }


        if (confirmPasswordInput) {
            confirmPasswordInput.value = "";
        }


        return true;

    } catch (error) {

        setMessage(
            error.message ||
            "Unable to create account."
        );

        return false;
    }
}


/* =========================================================
   ADMIN GUARD
   ========================================================= */

async function guard() {

    if (!init()) {
        return false;
    }


    try {

        const result =
            await sb.auth.getUser();


        if (
            result.error ||
            !result.data ||
            !result.data.user
        ) {

            window.location.href =
                "/admin/login.html";

            return false;
        }


        const user =
            result.data.user;


        const profile =
            await sb
                .from("profiles")
                .select("role,status")
                .eq("id", user.id)
                .single();


        if (
            profile.error ||
            !profile.data ||
            profile.data.role !== "admin" ||
            profile.data.status !== "approved"
        ) {

            await sb.auth.signOut();

            window.location.href =
                "/admin/login.html";

            return false;
        }


        return true;

    } catch (error) {

        console.error(
            "Admin guard error:",
            error
        );

        window.location.href =
            "/admin/login.html";

        return false;
    }
}


/* =========================================================
   LOGOUT
   ========================================================= */

async function logout() {

    try {

        if (!sb) {
            init();
        }


        if (sb) {
            await sb.auth.signOut();
        }

    } catch (error) {

        console.error(
            "Logout error:",
            error
        );

    } finally {

        window.location.href =
            "/admin/login.html";
    }
}


/* =========================================================
   GET DOCUMENTS
   ========================================================= */

async function docs() {

    if (!init()) {
        throw new Error(
            "Supabase is not configured."
        );
    }


    const result =
        await sb
            .from("documents")
            .select("*")
            .order(
                "created_at",
                {
                    ascending: false
                }
            );


    if (result.error) {
        throw result.error;
    }


    return result.data || [];
}


/* =========================================================
   UPLOAD DOCUMENT
   ========================================================= */

async function uploadDoc(
    title,
    type,
    file,
    accessMode = "preview"
) {

    if (!init()) {
        throw new Error(
            "Supabase is not configured."
        );
    }


    if (!title.trim()) {
        throw new Error(
            "Document title is required."
        );
    }


    if (!file) {
        throw new Error(
            "Please select a file."
        );
    }


    const allowedTypes = [
        "cv",
        "report",
        "certificate",
        "academic",
        "project",
        "other"
    ];


    if (!allowedTypes.includes(type)) {
        throw new Error("Invalid document type.");
    }

    if (!["preview", "download", "private"].includes(accessMode)) {
        throw new Error("Invalid document access mode.");
    }


    /* -----------------------------------------------
       Safe filename
    ------------------------------------------------ */

    const safeFileName =
        file.name.replace(
            /[^a-zA-Z0-9._-]/g,
            "_"
        );


    const path =
        crypto.randomUUID() +
        "-" +
        safeFileName;


    /* -----------------------------------------------
       Upload to private Storage
    ------------------------------------------------ */

    const upload =
        await sb
            .storage
            .from("documents")
            .upload(
                path,
                file,
                {
                    upsert: false,

                    contentType:
                        file.type ||
                        "application/octet-stream"
                }
            );


    if (upload.error) {
        throw upload.error;
    }


    try {

        /* -------------------------------------------
           Current admin
        -------------------------------------------- */

        const userResult =
            await sb.auth.getUser();


        if (
            userResult.error ||
            !userResult.data.user
        ) {

            throw new Error(
                "Authentication session expired."
            );
        }


        /* -------------------------------------------
           Save metadata
        -------------------------------------------- */

        const document =
            await sb
                .from("documents")
                .insert({

                    title:
                        title.trim(),

                    type,

                    storage_path:
                        path,

                    access_mode:
                        accessMode,

                    created_by:
                        userResult.data.user.id
                });


        if (document.error) {
            throw document.error;
        }


        return true;

    } catch (error) {

        /* -------------------------------------------
           Roll back storage upload
        -------------------------------------------- */

        await sb
            .storage
            .from("documents")
            .remove([path]);


        throw error;
    }
}


/* =========================================================
   UPDATE DOCUMENT ACCESS
   ========================================================= */

/*
 * Controls whether recruiters are allowed to download
 * the document.
 *
 * Preview access is handled by the server-side
 * /api/documents endpoint.
 */

async function updateDocAccess(
    id,
    accessMode
) {

    if (!init()) {
        throw new Error("Supabase is not configured.");
    }

    if (!["preview", "download", "private"].includes(accessMode)) {
        throw new Error("Invalid document access mode.");
    }

    const result = await sb
        .from("documents")
        .update({ access_mode: accessMode, download_allowed: accessMode === "download" })
        .eq("id", id);

    if (result.error) {
        throw result.error;
    }

    return true;
}

/* =========================================================
   DELETE DOCUMENT
   ========================================================= */

async function deleteDoc(
    id,
    path
) {

    if (!init()) {
        throw new Error(
            "Supabase is not configured."
        );
    }


    /* -----------------------------------------------
       Delete database record
    ------------------------------------------------ */

    const databaseResult =
        await sb
            .from("documents")
            .delete()
            .eq("id", id);


    if (databaseResult.error) {
        throw databaseResult.error;
    }


    /* -----------------------------------------------
       Delete storage object
    ------------------------------------------------ */

    if (path) {

        const storageResult =
            await sb
                .storage
                .from("documents")
                .remove([path]);


        if (storageResult.error) {

            console.error(
                "Storage deletion error:",
                storageResult.error
            );

            throw storageResult.error;
        }
    }


    return true;
}


/* =========================================================
   PASSWORD RESET REQUEST
   ========================================================= */

async function requestPasswordReset(email) {

    if (!init()) {
        return false;
    }

    const normalizedEmail = String(email || "").trim();

    if (!normalizedEmail) {
        setMessage("Enter your email address.");
        return false;
    }

    try {
        const redirectTo =
            `${window.location.origin}/reset-password.html`;

        const result =
            await sb.auth.resetPasswordForEmail(
                normalizedEmail,
                { redirectTo }
            );

        if (result.error) {
            throw result.error;
        }

        setMessage(
            "If an account exists for that email, a password reset link has been sent.",
            "success"
        );

        return true;

    } catch (error) {
        setMessage(
            error.message ||
            "Unable to send password reset email."
        );
        return false;
    }
}


/* =========================================================
   GET SECURE DOCUMENT URL
   ========================================================= */

async function getDocumentUrl(id, mode = "preview") {

    if (!init()) {
        throw new Error("Supabase is not configured.");
    }

    if (!["preview", "download"].includes(mode)) {
        throw new Error("Invalid document mode.");
    }

    const result = await sb
        .from("documents")
        .select("id,title,type,storage_path,access_mode")
        .eq("id", id)
        .single();

    if (result.error) {
        throw result.error;
    }

    const document = result.data;
    if (!document) {
        throw new Error("Document not found.");
    }

    // Admins can open private files; public files are limited to their selected mode.
    if (document.access_mode === "private") {
        const adminCheck = await sb
            .from("profiles")
            .select("id")
            .eq("id", (await sb.auth.getUser()).data.user?.id || "")
            .eq("role", "admin")
            .eq("status", "approved")
            .maybeSingle();

        if (adminCheck.error || !adminCheck.data) {
            throw new Error("This document is private.");
        }
    } else if (document.access_mode !== mode) {
        throw new Error(
            mode === "download"
                ? "Downloads are disabled for this document."
                : "Preview is disabled for this document."
        );
    }

    const signed = await sb
        .storage
        .from("documents")
        .createSignedUrl(
            document.storage_path,
            600,
            mode === "download" ? { download: true } : undefined
        );

    if (signed.error || !signed.data?.signedUrl) {
        throw signed.error || new Error("Unable to create document URL.");
    }

    return {
        id: document.id,
        title: document.title,
        type: document.type,
        accessMode: document.access_mode,
        mode,
        url: signed.data.signedUrl,
        expiresIn: 600
    };
}
