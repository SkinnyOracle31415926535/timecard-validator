# Timecard Validator

A small, dependency-free timecard validator for up to four consecutive Saturday–Friday workweeks. Each day supports up to three clock-in/out periods. Gaps between periods are checked for a 30-minute break, and each day's periods can be copied in a compact paste-ready format. Periods automatically sort by clock-in time after you finish editing a day. Your entries are saved automatically in this browser and restored when you reopen the app. Ryan can optionally connect App Sync to keep those entries available across his devices.

## Live page

[Open the Timecard Validator](https://skinnyoracle31415926535.github.io/timecard-validator/)

## Add to Home Screen

On iPhone or iPad, open the live page in Safari, choose **Share**, then choose **Add to Home Screen**. The installed app uses the green Timecard Validator icon.

## Checks

- Up to 40 paid hours per week
- Up to 8 paid hours per day
- At least one day off in each Saturday–Friday workweek
- A warning for days from 5½ through 6 worked hours without a 30-minute gap between periods
- An error for days longer than 6 worked hours without a 30-minute gap between periods

Validation runs locally in the browser. Timecard entries are uploaded only after Ryan connects App Sync, downloads a backup, reviews a zero-write migration preview, and applies it.
