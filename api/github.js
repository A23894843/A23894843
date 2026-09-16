// Vercel Serverless Function: live GitHub contribution data.
// Set GITHUB_TOKEN in Vercel Project Settings -> Environment Variables.
// The token is kept server-side and is never exposed to the browser.

export default async function handler(req, res) {
  const username = String(req.query.username || 'a23894843');
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    return res.status(500).json({ error: 'GITHUB_TOKEN is not configured on Vercel.' });
  }

  const start = new Date('2024-06-21T00:00:00Z');
  const end = new Date();

  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
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

  async function fetchWindow(from, to) {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'abhinandan-portfolio'
      },
      body: JSON.stringify({
        query,
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

  try {
    // GitHub limits a contributionsCollection date range to one year.
    // Six-month windows give the query plenty of resource headroom.
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
    let total = 0;

    for (const calendar of calendars) {
      total += Number(calendar.totalContributions) || 0;

      for (const week of calendar.weeks) {
        for (const day of week.contributionDays) {
          // If two windows touch on the boundary, keep one copy.
          dayMap.set(day.date, Number(day.contributionCount) || 0);
        }
      }
    }

    const days = [...dayMap.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const byDate = new Map(days.map(d => [d.date, d.count]));
    const iso = d => d.toISOString().slice(0, 10);

    // Current streak: today if active; otherwise start from yesterday.
    let cursorDate = new Date();
    cursorDate.setUTCHours(0, 0, 0, 0);

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

    // Longest consecutive active-day streak.
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

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');

    return res.status(200).json({
      username,
      updatedAt: new Date().toISOString(),
      stats: {
        total,
        currentStreak,
        currentStart,
        longestStreak,
        longestStart,
        longestEnd
      },
      days
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Unable to fetch GitHub contributions'
    });
  }
}
