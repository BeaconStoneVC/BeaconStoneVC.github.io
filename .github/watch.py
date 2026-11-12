"""Runs on GitHub once a day, away from the laptop: is the live site still being updated?

A laptop that's off can't report that it has stopped, so something elsewhere has to notice. Each publish
writes status.json with the time it went out. If that's older than MAX_AGE_HOURS, this fails, and GitHub
emails the account that a scheduled workflow failed.

Installed into the site's repo by C:\\code\\beaconstone from tools/watch. Edits made there are overwritten
by the next publish. Standard library only, so it runs on GitHub with nothing installed.
"""
import datetime as dt
import json
import sys
import time
import urllib.error
import urllib.request

STATUS_URL = "https://beaconstonevc.com/status.json"
# The run starts at 03:00 UK time and publishes by about 05:00; this checks at 12:00 UTC. So a normal day
# is 7 to 9 hours old, one missed day about 33 hours, and two about 57. One miss isn't worth an email.
MAX_AGE_HOURS = 45
TRIES = 3
WAIT_SECONDS = 120
USER_AGENT = "BeaconStoneVC-watch/1.0 (+https://beaconstonevc.com/methodology)"


def problem(status_text, now):
    """None if the site was published recently enough, otherwise what to tell the operator."""
    try:
        stamp = json.loads(status_text)["published_utc"]
        published = dt.datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    except (ValueError, KeyError, TypeError):
        return "The live site's status.json can't be read, so there's no telling when it was last updated."
    hours = (now - published).total_seconds() / 3600
    if hours <= MAX_AGE_HOURS:
        return None
    return (f"beaconstonevc.com was last updated {hours / 24:.1f} days ago, on {published:%d %B %Y at %H:%M} UTC. "
            "Either the daily run isn't happening (is the laptop on and logged in?) or its checks keep stopping it "
            "from publishing. The newest report in C:\\code\\beaconstone\\data\\days says which.")


def fetch(url):
    request = urllib.request.Request(f"{url}?check={int(time.time())}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8", errors="replace")


def main(fetch=fetch, sleep=time.sleep, now=None):
    text, failure = None, None
    for attempt in range(TRIES):
        try:
            text = fetch(STATUS_URL)
            break
        except OSError as error:
            failure = error
            if attempt < TRIES - 1:
                sleep(WAIT_SECONDS)
    if isinstance(failure, urllib.error.HTTPError) and text is None:
        message = (f"The live site answered HTTP {failure.code} for status.json, so there's no telling when it was "
                   "last updated.")
        if failure.code in (525, 526):
            # 2026-11-10: GitHub's certificate for the domain expired, and Cloudflare in Full (strict) refused it.
            message += (" Visitors see an error page: Cloudflare can't make a secure connection to GitHub Pages, "
                        "usually because GitHub's certificate for beaconstonevc.com has expired.")
    elif text is None:
        message = f"beaconstonevc.com couldn't be reached from GitHub after {TRIES} tries: {failure}"
    else:
        message = problem(text, now or dt.datetime.now(dt.timezone.utc))
    if message:
        # An error annotation puts the message on the failed run's page, which GitHub's email links to.
        print(f"::error title=BeaconStone needs you::{message}")
        return 1
    print("The live site is up to date.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
