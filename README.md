# Google Ads Performance Report → Telegram

Google Ads Script that sends periodic performance reports to each manager's personal Telegram chat and a group/channel.

Reports are broken down by **product category** and **channel type** (Search / Pmax), with period-over-period comparison.

---

## How it works

1. Script reads all active campaigns from the Google Ads account
2. Identifies which manager owns each campaign via a **label**
3. Extracts the **product category** from the campaign name
4. Fetches metrics for the current and previous period
5. Sends a formatted report to each manager's Telegram + group

---

## Campaign naming convention

Campaign names must follow this format:

```
LastName | Category | anything else
```

**Examples:**
```
Smith | Power Banks | Search
Smith | Power Banks | (CPA 35)
Johnson | Phone Cases |
Johnson | Wireless Chargers | Pmax
```

Rules:
- The part **before the first `|`** — manager's last name (ignored by script, label is used instead)
- The part **between first and second `|`** — product category (shown in report)
- The part **after second `|`** — ignored (use for notes, CPA targets, etc.)
- Category can contain spaces and multiple words: `Wireless Chargers`, `Screen Protectors`
- The separator is `|` with spaces around it

---

## Campaign labels

Each campaign must have **one label** with the manager's last name — exactly as written in `RECIPIENTS` in the script.

**Example:**

| Campaign | Label |
|----------|-------|
| Smith \| Power Banks \| Search | `Smith` |
| Smith \| Phone Cases \| Pmax | `Smith` |
| Johnson \| Chargers \| | `Johnson` |

Rules:
- Label name is **case-sensitive** — `Smith` ≠ `smith`
- One label per campaign (manager)
- Label must exactly match the key in `RECIPIENTS`
- Labels on **inactive/paused campaigns are ignored** — script uses `AdsApp.campaigns()` which returns only `ENABLED` by default

> ⚠️ If a campaign has no label or the label doesn't match `RECIPIENTS` — it won't appear in any report.

---

## Setup

### 1. Create a Telegram bot

1. Open Telegram → find `@BotFather`
2. Send `/newbot` and follow instructions
3. Copy the bot token (looks like `1234567890:AAFxxxxxxx`)
4. Add the bot to your group/channel and make it **admin**

### 2. Get Telegram IDs

**Your personal ID:**
- Write to `@userinfobot` in Telegram — it replies with your ID

**Group/channel ID:**
- Add `@getmyid_bot` to the group — it will post the group ID
- Group IDs start with `-100...`

**Manager IDs:**
- Each manager must find and start your bot (send `/start`)
- Then they can get their ID via `@userinfobot`

### 3. Configure the script

Open the script and fill in `CONFIG`:

```javascript
var CONFIG = {

  // Bot token without "bot" prefix
  TELEGRAM_BOT_TOKEN: '1234567890:AAFxxxxxxx',

  // Group chat ID (starts with -100)
  GROUP_CHAT_ID: '-1001234567890',

  // Label (last name) → array of Telegram personal chat IDs
  // One manager can have multiple IDs: ['ID1', 'ID2']
  RECIPIENTS: {
    'Smith':    ['123456789'],
    'Johnson':  ['987654321', '555555555'], // two recipients
    'Williams': ['111222333'],
  },

  // Period: 1 / 7 / 14 / 30 days
  PERIOD_DAYS: 14,

};
```

### 4. Add to Google Ads

1. Go to **Google Ads → Tools → Bulk Actions → Scripts**
2. Click `+` to create a new script
3. Paste the script content
4. Click **Authorize**
5. Click **Preview** to test

### 5. Schedule

1. In the script editor click **Create schedule**
2. Set frequency: weekly / biweekly / monthly
3. Match `PERIOD_DAYS` to your schedule:
   - `PERIOD_DAYS: 7` → run weekly
   - `PERIOD_DAYS: 14` → run every 2 weeks
   - `PERIOD_DAYS: 30` → run monthly

---

## Report format

```
📊 Report for period
📅 30.03.2026 — 12.04.2026
👤 Manager: Smith
─────────────────────

🟢 Search | Power Banks
Spend: 1200 (+5%)
Conv: 14 (+8%)
CPA: 85 (-4%)
Revenue: 18500 (+12%)
Avg order: 1321 (+4%)
ROAS: 1541% (+6%)

🟢 Pmax | Power Banks
Spend: 800 (+3%)
...

─────────────────────
💁‍♂️ Total
Spend: 15000 (+5%)
Conv: 120 (+8%)
CPA: 125 (-3%)
Revenue: 85000 (+12%)
Avg order: 708 (+4%)
ROAS: 566% (+6%)
```

---

## Metrics

| Metric | Description |
|--------|-------------|
| Spend | Total cost |
| Conv | Conversions count |
| CPA | Cost per conversion |
| Revenue | Conversions value |
| Avg order | Revenue / Conversions |
| ROAS | Revenue / Spend × 100% |

All values are **rounded to integers**. Delta shows % change vs previous period.

---

## Requirements

- Google Ads account (single account, not MCC)
- Campaigns must use `|` naming convention
- Each campaign must have a manager label
- Managers must send `/start` to the bot at least once
- Bot must be added as admin to the group/channel

---

## Notes

- Script uses `AdsApp.campaigns()` + `AdsApp.performanceMaxCampaigns()` — covers Search, Shopping, Display, Pmax
- Campaigns without `|` in the name are ignored (safe to have old campaigns)
- Categories with zero spend and zero conversions in current period are skipped
- If report is too long for one Telegram message — it's automatically split into parts
