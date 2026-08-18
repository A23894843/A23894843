\
import datetime as dt
import json
import os
import re
import urllib.request

TOKEN = os.environ["GITHUB_TOKEN"]
USERNAME = os.environ.get("GITHUB_USERNAME", "a23894843")
README = "README.md"

# Ask GitHub for the user's contribution calendar for the last year.
today = dt.date.today()
from_date = today - dt.timedelta(days=366)

query = """
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
"""

payload = json.dumps({
    "query": query,
    "variables": {
        "login": USERNAME,
        "from": f"{from_date.isoformat()}T00:00:00Z",
        "to": f"{today.isoformat()}T23:59:59Z",
    },
}).encode()

request = urllib.request.Request(
    "https://api.github.com/graphql",
    data=payload,
    headers={
        "Authorization": f"bearer {TOKEN}",
        "Content-Type": "application/json",
        "User-Agent": "github-actions-streak-updater",
    },
    method="POST",
)

with urllib.request.urlopen(request) as response:
    result = json.load(response)

if "errors" in result:
    raise RuntimeError(json.dumps(result["errors"], indent=2))

user = result.get("data", {}).get("user")
if not user:
    raise RuntimeError(f"GitHub user not found: {USERNAME}")

days = {}
for week in user["contributionsCollection"]["contributionCalendar"]["weeks"]:
    for day in week["contributionDays"]:
        days[dt.date.fromisoformat(day["date"])] = day["contributionCount"]

# GitHub-style current streak:
# - If there is a contribution today, count backward from today.
# - Otherwise, count backward from the most recent contributing day.
# - A day with zero contributions breaks the streak.
start = today if days.get(today, 0) > 0 else today - dt.timedelta(days=1)

# If yesterday also has no contribution, the current streak is 0.
if days.get(start, 0) == 0:
    streak = 0
else:
    streak = 0
    current = start
    while days.get(current, 0) > 0:
        streak += 1
        current -= dt.timedelta(days=1)

streak_text = f"🔥 {streak} days and counting"

readme = open(README, "r", encoding="utf-8").read()

# Update the Python profile field.
readme, field_count = re.subn(
    r'self\.streak\s*=\s*"[^"]*"',
    f'self.streak      = "{streak_text}"',
    readme,
    count=1,
)

# Update the visible README streak.
readme, visible_count = re.subn(
    r'(\*\*Current contribution streak:\s*`)[^`]*(`\*\*)',
    rf'\g<1>{streak_text}\g<2>',
    readme,
    count=1,
)

if field_count != 1 or visible_count != 1:
    raise RuntimeError(
        "README markers were not found exactly once. "
        "The workflow stopped without changing the README."
    )

open(README, "w", encoding="utf-8").write(readme)
print(f"Updated GitHub contribution streak to: {streak_text}")
