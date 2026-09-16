// Vercel Serverless Function: live GitHub contribution data.
//
// Primary source: GitHub GraphQL (if GITHUB_TOKEN is configured).
// Fallback: public GitHub Contributions API, so the portfolio still works
// without a GitHub token. The token is never exposed to the browser.

export default async function handler(req, res) {
  const username = String(req.query.username || 'a23894843').trim();

  if (!/^[A-Za-z0-9-]+$/.test(username)) {
    return res.status(400).json({ error: 'Invalid GitHub username.' });
  }

  const start = new Date('2024-06-21T00:00:00Z');
  const end = new Date();

  const graphQLQuery = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  async function fetchGraphQL() {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN is not configured');

    async function fetchWindow(from, to) {
      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'abhinandan-portfolio'
        },
        body: JSON.stringify({
          query: graphQLQuery,
          variables: {
            login: username,
            from: from.toISOString(),
            to: to.toISOString()
          }
        }),
        cache: 'no-store'
      });

      const body = await response.json();
      if (!response.ok || body.errors?.length || !body.data?.user) {
        throw new Error(
          body.errors?.map(e => e.message).join('; ') ||
          'GitHub GraphQL request failed'
        );
      }

      return body.data.user.contributionsCollection.contributionCalendar;
    }

    // GitHub limits a contributionsCollection range to one year.
    // Six-month windows also keep query cost/resource usage low.
    const windows = [];
    let cursor = new Date(start);

    while (cursor < end) {
      const next = new Date(cursor);
      next.setUTCMonth(next.getUTCMonth() + 6);
      const windowEnd = next < end ? next : end;
      windows.push([new Date(cursor), windowEnd]);
      cursor = windowEnd;
    }

    const calendars = await Promise.all(
      windows.map(([from, to]) => fetchWindow(from, to))
    );

    const dayMap = new Map();
    for (const calendar of calendars) {
      for (const week of calendar.weeks) {
        for (const day of week.contributionDays) {
          dayMap.set(day.date, Number(day.contributionCount) || 0);
        }
      }
    }

    return [...dayMap.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async function fetchPublicAPI() {
    const url = `https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(username)}?y=all`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'abhinandan-portfolio' },
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`Public GitHub contributions API returned HTTP ${response.status}`);
    }

    const body = await response.json();
    if (!Array.isArray(body.contributions)) {
      throw new Error('Invalid public GitHub contributions response');
    }

    return body.contributions
      .filter(day => day.date >= '2024-06-21')
      .map(day => ({
        date: day.date,
        count: Number(day.count) || 0
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function calculateStats(days) {
    const total = days.reduce((sum, day) => sum + day.count, 0);
    const byDate = new Map(days.map(day => [day.date, day.count]));

    // Work from the latest date actually returned by GitHub rather than the
    // server's timezone. This keeps the streak aligned with GitHub's calendar.
    let cursorDate = days.length ? new Date(days[days.length - 1].date + 'T00:00:00Z') : new Date();
    const iso = d => d.toISOString().slice(0, 10);

    // GitHub treats an unfinished current day as not breaking an existing streak.
    if ((byDate.get(iso(cursorDate)) || 0) === 0) {
      cursorDate.setUTCDate(cursorDate.getUTCDate() - 1);
    }

    let currentStreak = 0;
    let currentStart = '';
    while ((byDate.get(iso(cursorDate)) || 0) > 0) {
      currentStart = iso(cursorDate);
      currentStreak++;
      cursorDate.setUTCDate(cursorDate.getUTCDate() - 1);
    }

    let longestStreak = 0;
    let longestStart = '';
    let longestEnd = '';
    let run = 0;
    let runStart = '';

    for (const day of days) {
      if (day.count > 0) {
        if (run === 0) runStart = day.date;
        run++;
        if (run > longestStreak) {
          longestStreak = run;
          longestStart = runStart;
          longestEnd = day.date;
        }
      } else {
        run = 0;
        runStart = '';
      }
    }

    return {
      total,
      currentStreak,
      currentStart,
      longestStreak,
      longestStart,
      longestEnd
    };
  }

  try {
    let days;
    let source = 'github-graphql';

    try {
      days = await fetchGraphQL();
    } catch (graphqlError) {
      // If the token is missing/invalid/rate-limited, keep the public portfolio
      // functional by falling back to the public contribution calendar API.
      source = 'public-contributions-api';
      days = await fetchPublicAPI();
    }

    const stats = calculateStats(days);

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');

    return res.status(200).json({
      username,
      updatedAt: new Date().toISOString(),
      source,
      stats,
      days
    });
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(502).json({
      error: error.message || 'Unable to fetch GitHub contributions'
    });
  }
}
