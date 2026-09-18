/* =========================================================
   LEETCODE SERVERLESS API
   ========================================================= */

export default async function handler(req, res) {

    const username =
        String(
            req.query.username ||
            "a23894843"
        ).trim();


    if (!username) {

        return res.status(400).json({
            error: "LeetCode username is required."
        });
    }


    /* =====================================================
       GRAPHQL QUERY
    ===================================================== */

    const query = `
        query getUserProfile(
            $username: String!
        ) {

            matchedUser(
                username: $username
            ) {

                username

                submitStats:
                    submitStatsGlobal {

                    acSubmissionNum {
                        difficulty
                        count
                    }
                }
            }
        }
    `;


    try {

        /* =================================================
           REQUEST LEETCODE
        ================================================= */

        const response =
            await fetch(
                "https://leetcode.com/graphql/",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "Referer":
                            "https://leetcode.com/",

                        "User-Agent":
                            "Mozilla/5.0"
                    },

                    body: JSON.stringify({

                        query,

                        variables: {
                            username
                        }
                    }),

                    cache: "no-store"
                }
            );


        const body =
            await response.json();


        /* =================================================
           VALIDATE RESPONSE
        ================================================= */

        if (
            !response.ok ||
            body.errors?.length ||
            !body.data?.matchedUser
        ) {

            return res.status(502).json({

                error:
                    "LeetCode profile could not be retrieved.",

                details:
                    body.errors || null
            });
        }


        const stats =
            body.data.matchedUser
                .submitStats
                ?.acSubmissionNum || [];


        /* =================================================
           EXTRACT DIFFICULTY COUNTS
        ================================================= */

        function getCount(difficulty) {

            const row =
                stats.find(
                    item =>
                        item.difficulty === difficulty
                );


            return row
                ? Number(row.count) || 0
                : 0;
        }


        const easySolved =
            getCount("Easy");

        const mediumSolved =
            getCount("Medium");

        const hardSolved =
            getCount("Hard");


        /* =================================================
           TOTAL
        ================================================= */

        const totalSolved =
            easySolved +
            mediumSolved +
            hardSolved;


        /* =================================================
           RESPONSE
        ================================================= */

        res.setHeader(
            "Cache-Control",
            "no-store, max-age=0"
        );

        res.setHeader(
            "CDN-Cache-Control",
            "no-store"
        );


        return res.status(200).json({

            username,

            totalSolved,

            easySolved,

            mediumSolved,

            hardSolved
        });


    } catch (error) {

        console.error(
            "LeetCode API error:",
            error
        );


        return res.status(500).json({

            error:
                "Unable to retrieve LeetCode statistics."
        });
    }
}
