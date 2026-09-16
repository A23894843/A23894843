// Vercel Serverless Function: live LeetCode solved counts.
// Uses LeetCode's public GraphQL endpoint server-side so the browser
// does not depend on third-party CORS proxies.

export default async function handler(req, res) {
  const username = String(req.query.username || 'a23894843');

  const query = `
    query getUserProfile($username: String!) {
      matchedUser(username: $username) {
        username
        submitStats: submitStatsGlobal {
          acSubmissionNum {
            difficulty
            count
          }
        }
      }
    }
  `;

  try {
    const lc = await fetch('https://leetcode.com/graphql/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'https://leetcode.com/',
        'User-Agent': 'Mozilla/5.0'
      },
      body: JSON.stringify({
        query,
        variables: { username }
      }),
      cache: 'no-store'
    });

    const body = await lc.json();

    if (!lc.ok || body.errors?.length || !body.data?.matchedUser) {
      return res.status(502).json({
        error: 'LeetCode GraphQL request failed',
        details: body.errors || body
      });
    }

    const rows = body.data.matchedUser.submitStats.acSubmissionNum || [];
    const get = difficulty => {
      const row = rows.find(x => x.difficulty === difficulty);
      return row ? Number(row.count) || 0 : 0;
    };

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    return res.status(200).json({
      username,
      easySolved: get('Easy'),
      mediumSolved: get('Medium'),
      hardSolved: get('Hard')
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
