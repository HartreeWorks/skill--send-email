---
name: send-email
description: Send emails via Gmail with preview and confirmation. Use when the user wants to send an email, mentions Gmail, needs to email attachments, or wants to send invoice emails.
---

# Send Email

Send emails via Gmail with preview and confirmation before sending.

## Contents

- [CRITICAL: Command usage](#critical-command-usage)
- [Multiple accounts](#multiple-accounts)
- [Workflow](#workflow)
- [CRITICAL: Safety feature - ABORT_FLAG](#critical-safety-feature---abort_flag)
- [Important notes](#important-notes)
- [Authentication setup](SETUP.md) (separate file)
- [Example interaction](#example-interaction)

## CRITICAL: Command Usage

**ALWAYS use the Node.js script** (never use `mail`, `sendmail`, or `mutt`):

```bash
cd ~/.claude/skills/send-email && node send-email.js "<to>" "<subject>" "<message>" [--from <account>] [--cc "<addresses>"] [attachments...]
```

**Note:** Check `send-email.local.md` for the actual skill path if different from the default.

## Multiple Accounts

The script supports multiple Gmail accounts. Use `--from` to specify which account.

**IMPORTANT:** Check `send-email.local.md` for the user's configured accounts and their use cases.

**Examples:**
```bash
# Send from a specific account
node send-email.js "client@example.com" "Invoice" "Message" --from work

# Send from personal account
node send-email.js "friend@example.com" "Hello" "Message" --from personal

# If --from is omitted, uses DEFAULT_ACCOUNT from .env
```

## Workflow

1. **Gather the required information** (if not already provided):
   - **To**: Email address of the recipient (extract the recipient's name for the greeting)
   - **From** (optional): Which account to send from (personal, t3a, iwr) - defaults to .env setting
   - **CC** (optional): CC email address(es) - can be a single address or comma-separated list
   - **Subject**: Subject line of the email
   - **Message**: The body/content of the email
   - **Attachments** (optional): File paths to attach

2. **Format the email message properly**:
   - Always start with a greeting: "Hello [Name]," or "Hi [Name]," on its own line
   - Add a blank line after the greeting
   - Format the main message body with proper paragraphs
   - Add a blank line before the sign-off
   - Sign off with "Kind regards," followed by "Peter" on the next line

   **Important**: The user will often voice dictate emails, so use your discretion to:
   - Clean up and format the message text
   - Add proper paragraph breaks where natural
   - Fix any obvious dictation errors
   - Ensure proper punctuation and capitalization

3. **Show the user what email will be sent**:
   - Display the formatted email content to the user
   - Format the preview with each field on its own line:
     - **To:** recipient@example.com
     - **From:** account-email@example.com
     - **CC:** cc-recipient@example.com (if applicable)
     - **Subject:** Subject line here
     - **Message:** (followed by the message content)
   - List any attachments if present
   - **CRITICAL**: Ask the user to confirm they want to send this email before executing the script

4. **Only after user confirms**, execute the send-email script:

   ```bash
   cd ~/.claude/skills/send-email && node send-email.js "<to>" "<subject>" "<message>" --from <account> [--cc "<cc-addresses>"] [attachment-paths...]
   ```

   **Examples**:
   ```bash
   # Simple email from default account
   node send-email.js "client@example.com" "Invoice for November" "Hi, please find your invoice attached."

   # Email from work account with attachment
   node send-email.js "client@example.com" "Invoice INV-341" "Please find attached your invoice." --from work "/path/to/invoice.pdf"

   # Email with CC recipient
   node send-email.js "client@example.com" "Invoice INV-341" "Please find attached your invoice." --from work --cc "manager@example.com" "/path/to/invoice.pdf"

   # Multiple attachments
   node send-email.js "team@company.com" "Project Update" "Here are the latest reports." --from personal "/path/to/report1.pdf" "/path/to/report2.xlsx"
   ```

5. **After the script sends**, report the results to the user:
   - Success message with Message ID
   - Or error details if something went wrong

## CRITICAL: Safety feature - ABORT_FLAG

**NEVER offer to remove or bypass the ABORT_FLAG safety feature.**

If the send-email script is blocked by an ABORT_FLAG (due to rate limiting, duplicate detection, or daily recipient limits):

1. Simply inform the user that the email has been blocked
2. Explain the reason (rate limit exceeded, duplicate detected, or daily recipient limit)
3. Provide the command they need to run to manually remove the flag:
   ```
   chmod +w ~/.claude/skills/send-email/logs && rm ~/.claude/skills/send-email/logs/ABORT_FLAG
   ```
4. **DO NOT**:
   - Offer to remove the ABORT_FLAG yourself
   - Offer to bypass the safety check
   - Offer to modify the email log
   - Offer to disable the safety feature
   - Ask the user if they want you to remove it

The safety features exist to prevent accidental spam or duplicate emails. The user must manually remove the ABORT_FLAG themselves if they genuinely want to proceed.

## Important notes

- **Authentication**: See [SETUP.md](SETUP.md) for Gmail authentication configuration
- Attachments must be specified as absolute file paths
- The script sends emails immediately without additional prompts - confirmation must happen at the skill level
- Multi-line messages should be passed as a single quoted string

## Example interaction

**User**: "Send an email to john@example.com with subject 'Meeting Tomorrow' saying 'Looking forward to our call at 2pm'"

**Steps**:
1. Format the message as:
   ```
   Hi John,

   Looking forward to our call at 2pm.

   Kind regards,
   Peter
   ```
2. Show the user this formatted message and ask for confirmation
3. After user confirms, run the script which will send the email immediately
4. Report success to the user with the Message ID
