/* =========================================================
   SUPABASE AUTHENTICATION & DOCUMENT MANAGEMENT
   ========================================================= */


/* =========================================================
   SUPABASE CLIENT
   ========================================================= */

let sb = null;


/* =========================================================
   MESSAGE HANDLER
   ========================================================= */

/**
 * Displays a message on the current page.
 *
 * Supports:
 * - #message  → new structured signup/login pages
 * - #msg      → compatibility with older pages
 */
function setMessage(text, type = "error") {

    const element =
        document.getElementById("message") ||
        document.getElementById("msg");

    if (!element) {
        return;
    }

    element.textContent = text;

    /* Reset classes */

    element.classList.remove("success");

    /* Success message */

    if (type === "success") {
        element.classList.add("success");

        /* Also support older CSS */
        element.style.color = "var(--t)";
    }

    /* Error message */

    else {
        element.style.color = "var(--r)";
    }
}


/* =========================================================
   INITIALIZE SUPABASE
   ========================================================= */

function init() {

    /* -----------------------------------------------------
       Check Supabase library
    ----------------------------------------------------- */

    if (!window.supabase) {

        setMessage(
            "Supabase library could not be loaded."
        );

        return false;
    }


    /* -----------------------------------------------------
       Check configuration
    ----------------------------------------------------- */

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


    /* -----------------------------------------------------
       Create client only once
    ----------------------------------------------------- */

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
        return;
    }


    try {

        /* -------------------------------------------------
           Sign in using Supabase Auth
        ------------------------------------------------- */

        const result =
            await sb.auth.signInWithPassword({
                email: email,
                password: password
            });


        if (result.error) {
            throw result.error;
        }


        /* -------------------------------------------------
           Verify admin profile
        ------------------------------------------------- */

        const profile =
            await sb
                .from("profiles")
                .select("role, status")
                .eq("id", result.data.user.id)
                .single();


        if (
            profile.error ||
            !profile.data ||
            profile.data.role !== "admin" ||
            profile.data.status !== "approved"
        ) {

            await sb.auth.signOut();

            throw new Error(
                "Account is pending or not authorized."
            );
        }


        /* -------------------------------------------------
           Login successful
        ------------------------------------------------- */

        window.location.href =
            "/admin/documents.html";

    }

    catch (error) {

        setMessage(
            error.message ||
            "Unable to sign in."
        );
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
        return;
    }


    /* -----------------------------------------------------
       Validate password confirmation
    ----------------------------------------------------- */

    if (password !== confirmPassword) {

        setMessage(
            "Passwords do not match."
        );

        return;
    }


    /* -----------------------------------------------------
       Validate password length
    ----------------------------------------------------- */

    if (password.length < 15) {

        setMessage(
            "Use at least 15 characters."
        );

        return;
    }


    try {

        /* -------------------------------------------------
           Create Supabase Auth account
        ------------------------------------------------- */

        const result =
            await sb.auth.signUp({

                email: email,

                password: password,

                options: {
                    data: {
                        display_name: name
                    }
                }
            });


        /* -------------------------------------------------
           Check signup result
        ------------------------------------------------- */

        if (result.error) {
            throw result.error;
        }


        if (!result.data.user) {

            throw new Error(
                "Account could not be created."
            );
        }


        /* -------------------------------------------------
           Create pending admin profile
        ------------------------------------------------- */

        const profile =
            await sb
                .from("profiles")
                .upsert({
                    id: result.data.user.id,
                    display_name: name,
                    role: "admin",
                    status: "pending"
                });


        if (profile.error) {
            throw profile.error;
        }


        /* -------------------------------------------------
           Registration successful
        ------------------------------------------------- */

        setMessage(
            "Registration submitted. Verify your email if required, then wait for admin approval.",
            "success"
        );


        /* -------------------------------------------------
           Clear password fields
        ------------------------------------------------- */

        const passwordInput =
            document.getElementById("passwordInput");

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

    }

    catch (error) {

        setMessage(
            error.message ||
            "Unable to create account."
        );
    }
}


/* =========================================================
   ADMIN GUARD
   ========================================================= */

/**
 * Protects private admin pages.
 *
 * The user must:
 * 1. Be authenticated
 * 2. Have role = admin
 * 3. Have status = approved
 */

async function guard() {

    if (!init()) {
        return false;
    }


    try {

        /* -------------------------------------------------
           Get currently authenticated user
        ------------------------------------------------- */

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


        /* -------------------------------------------------
           Check profile authorization
        ------------------------------------------------- */

        const profile =
            await sb
                .from("profiles")
                .select("role, status")
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

    }

    catch (error) {

        console.error(
            "Authentication guard error:",
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

    }

    catch (error) {

        console.error(
            "Logout error:",
            error
        );

    }

    finally {

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
    downloadAllowed
) {

    if (!init()) {
        throw new Error(
            "Supabase is not configured."
        );
    }


    if (!file) {
        throw new Error(
            "Please select a file."
        );
    }


    /* -----------------------------------------------------
       Generate unique storage path
    ----------------------------------------------------- */

    const safeFileName =
        file.name.replace(
            /[^a-zA-Z0-9._-]/g,
            "_"
        );


    const path =
        crypto.randomUUID() +
        "-" +
        safeFileName;


    /* -----------------------------------------------------
       Upload file to private Storage bucket
    ----------------------------------------------------- */

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

        /* -------------------------------------------------
           Get authenticated admin
        ------------------------------------------------- */

        const currentUser =
            await sb.auth.getUser();


        if (
            currentUser.error ||
            !currentUser.data ||
            !currentUser.data.user
        ) {

            throw new Error(
                "Authentication session expired."
            );
        }


        /* -------------------------------------------------
           Save document metadata
        ------------------------------------------------- */

        const document =
            await sb
                .from("documents")
                .insert({
                    title: title,
                    type: type,
                    storage_path: path,
                    download_allowed:
                        Boolean(downloadAllowed),
                    created_by:
                        currentUser.data.user.id
                });


        if (document.error) {
            throw document.error;
        }

    }

    catch (error) {

        /* -------------------------------------------------
           Roll back uploaded file if DB insert fails
        ------------------------------------------------- */

        await sb
            .storage
            .from("documents")
            .remove([path]);


        throw error;
    }
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


    /* -----------------------------------------------------
       Delete database record
    ----------------------------------------------------- */

    const databaseResult =
        await sb
            .from("documents")
            .delete()
            .eq("id", id);


    if (databaseResult.error) {
        throw databaseResult.error;
    }


    /* -----------------------------------------------------
       Delete storage object
    ----------------------------------------------------- */

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
}
