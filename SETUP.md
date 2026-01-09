# Authentication Setup

The send-email skill requires Gmail authentication to be configured before use.

## Requirements

If the user hasn't set up Gmail authentication yet, direct them to the README.md in this skill folder.

## Setup Steps

They need to:

1. Enable 2FA on their Google account
2. Generate an App Password at https://myaccount.google.com/apppasswords
3. Copy `.env.example` to `.env` and fill in credentials
4. Copy `send-email.local.md.example` to `send-email.local.md` and configure their accounts

## Sender Configuration

The email will be sent from the configured Gmail account, with the sender name configured via `GMAIL_NAME_<account>` in `.env`.

## Technical Details

- The script requires Gmail credentials to be configured in `.env`
- The script uses Gmail's SMTP server with an App Password (not the user's regular password)
- All emails are sent from the Gmail account configured in `.env`
- Account-specific settings are documented in `send-email.local.md`
