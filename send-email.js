#!/usr/bin/env node

/**
 * Send email via Gmail SMTP
 * Usage: node send-email.js <to> <subject> <message> [--from <account>] [--cc <addresses>] [attachments...]
 *
 * Accounts are configured in .env with the format:
 *   GMAIL_USER_<account>=email@example.com
 *   GMAIL_PASSWORD_<account>=app-password
 *   GMAIL_NAME_<account>=Display Name
 *
 * Use --from to specify which account to send from (e.g., --from t3a, --from personal)
 * If not specified, uses DEFAULT_ACCOUNT from .env
 */

import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.join(__dirname, '.env');
const LOGS_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'email-log.json');
const ABORT_FILE = path.join(LOGS_DIR, 'ABORT_FLAG');
const RATE_LIMIT_SECONDS = 30;

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('Usage: node send-email.js <to> <subject> <message> [--from <account>] [--cc <addresses>] [attachment1] [attachment2] ...');
  console.error('');
  console.error('Options:');
  console.error('  --from <account>  Account to send from (e.g., personal, t3a, iwr)');
  console.error('  --cc <addresses>  CC recipients (comma-separated for multiple)');
  console.error('');
  console.error('Examples:');
  console.error('  node send-email.js "client@example.com" "Invoice INV-123" "Please find attached your invoice." ./invoice.pdf');
  console.error('  node send-email.js "client@example.com" "Invoice" "Message" --from t3a ./invoice.pdf');
  console.error('  node send-email.js "client@example.com" "Invoice" "Message" --from personal --cc "other@example.com" ./invoice.pdf');
  process.exit(1);
}

const [to, subject, message, ...remainingArgs] = args;

// Parse optional flags and attachments
let cc = null;
let fromAccount = null;
let attachmentPaths = [];

for (let i = 0; i < remainingArgs.length; i++) {
  if (remainingArgs[i] === '--cc' && i + 1 < remainingArgs.length) {
    cc = remainingArgs[i + 1];
    i++; // Skip the value
  } else if (remainingArgs[i] === '--from' && i + 1 < remainingArgs.length) {
    fromAccount = remainingArgs[i + 1];
    i++; // Skip the value
  } else if (!remainingArgs[i].startsWith('--')) {
    attachmentPaths.push(remainingArgs[i]);
  }
}

// Load config
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('Error: .env file not found!');
  console.error('Please copy .env.example to .env and configure your Gmail credentials.');
  process.exit(1);
}

const config = {};
fs.readFileSync(CONFIG_PATH, 'utf-8').split('\n').forEach(line => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const [key, ...valueParts] = trimmed.split('=');
    if (key && valueParts.length > 0) {
      config[key.trim()] = valueParts.join('=').trim();
    }
  }
});

// Get default account if --from not specified
if (!fromAccount) {
  fromAccount = config.DEFAULT_ACCOUNT;
  if (!fromAccount) {
    console.error('Error: No --from account specified and no DEFAULT_ACCOUNT in .env');
    process.exit(1);
  }
}

// Get account credentials
const GMAIL_USER = config[`GMAIL_USER_${fromAccount}`];
const GMAIL_APP_PASSWORD = config[`GMAIL_PASSWORD_${fromAccount}`];
const GMAIL_NAME = config[`GMAIL_NAME_${fromAccount}`] || 'Peter Hartree';

if (!GMAIL_USER) {
  console.error(`Error: Account '${fromAccount}' not found in .env`);
  console.error('');
  console.error('Available accounts:');
  const accounts = Object.keys(config)
    .filter(k => k.startsWith('GMAIL_USER_'))
    .map(k => k.replace('GMAIL_USER_', ''));
  accounts.forEach(acc => {
    console.error(`  --from ${acc}  (${config[`GMAIL_USER_${acc}`]})`);
  });
  process.exit(1);
}

if (!GMAIL_APP_PASSWORD || GMAIL_APP_PASSWORD.startsWith('PLACEHOLDER')) {
  console.error(`Error: App password not configured for account '${fromAccount}'`);
  console.error(`Please set GMAIL_PASSWORD_${fromAccount} in .env`);
  console.error('');
  console.error('Get an App Password: https://myaccount.google.com/apppasswords');
  process.exit(1);
}

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Safety check: Check if abort flag exists
if (fs.existsSync(ABORT_FILE)) {
  const abortData = JSON.parse(fs.readFileSync(ABORT_FILE, 'utf-8'));
  console.error('');
  console.error('❌ ABORT FLAG DETECTED');
  console.error('');
  console.error('Email sending has been blocked due to a previous safety violation:');
  console.error(`  Reason: ${abortData.reason}`);
  console.error(`  Timestamp: ${abortData.timestamp}`);
  console.error(`  Details: ${abortData.details}`);
  console.error('');
  console.error('To re-enable email sending, delete the abort flag file:');
  console.error(`  rm ${ABORT_FILE}`);
  console.error('');
  process.exit(1);
}

// Load email log
let emailLog = [];
if (fs.existsSync(LOG_FILE)) {
  try {
    emailLog = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
  } catch (error) {
    console.error('Warning: Could not parse email log file. Starting fresh.');
    emailLog = [];
  }
}

/**
 * Creates an abort flag file and sets read-only permissions
 */
function createAbortFlag(reason, details, attemptedEmail, previousEmail) {
  const abortReason = {
    reason,
    timestamp: new Date().toISOString(),
    details,
    attemptedEmail,
    previousEmail
  };

  fs.writeFileSync(ABORT_FILE, JSON.stringify(abortReason, null, 2));

  try {
    fs.chmodSync(ABORT_FILE, 0o444);
    fs.chmodSync(LOGS_DIR, 0o555);
  } catch (error) {
    // If chmod fails, continue anyway
  }

  return abortReason;
}

// Safety check: Rate limiting (max 1 email per 30 seconds)
if (emailLog.length > 0) {
  const lastEmail = emailLog[emailLog.length - 1];
  const lastEmailTime = new Date(lastEmail.timestamp).getTime();
  const now = Date.now();
  const timeSinceLastEmail = (now - lastEmailTime) / 1000;

  if (timeSinceLastEmail < RATE_LIMIT_SECONDS) {
    createAbortFlag(
      'RATE_LIMIT_EXCEEDED',
      `Attempted to send email ${timeSinceLastEmail.toFixed(1)}s after previous email (minimum: ${RATE_LIMIT_SECONDS}s)`,
      { to, subject, timestamp: new Date().toISOString() },
      { to: lastEmail.to, subject: lastEmail.subject, timestamp: lastEmail.timestamp }
    );

    console.error('');
    console.error('❌ RATE LIMIT EXCEEDED');
    console.error('');
    console.error(`You can only send 1 email every ${RATE_LIMIT_SECONDS} seconds.`);
    console.error(`Time since last email: ${timeSinceLastEmail.toFixed(1)}s`);
    console.error('');
    console.error('To re-enable email sending:');
    console.error(`  chmod +w ${LOGS_DIR} && rm ${ABORT_FILE}`);
    console.error('');
    process.exit(1);
  }

  // Safety check: Daily recipient limit (max 1 email per recipient per 24 hours)
  const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
  const recentEmailsToRecipient = emailLog.filter(email => {
    const emailTime = new Date(email.timestamp).getTime();
    return email.to === to && emailTime > twentyFourHoursAgo;
  });

  if (recentEmailsToRecipient.length > 0) {
    const lastEmailToRecipient = recentEmailsToRecipient[recentEmailsToRecipient.length - 1];
    const hoursSinceLastEmail = ((Date.now() - new Date(lastEmailToRecipient.timestamp).getTime()) / (1000 * 60 * 60)).toFixed(1);

    createAbortFlag(
      'DAILY_RECIPIENT_LIMIT_EXCEEDED',
      `Attempted to send email to ${to} only ${hoursSinceLastEmail} hours after previous email (minimum: 24 hours)`,
      { to, subject, timestamp: new Date().toISOString() },
      { to: lastEmailToRecipient.to, subject: lastEmailToRecipient.subject, timestamp: lastEmailToRecipient.timestamp }
    );

    console.error('');
    console.error('❌ DAILY RECIPIENT LIMIT EXCEEDED');
    console.error('');
    console.error(`You can only send 1 email per recipient every 24 hours.`);
    console.error(`Recipient: ${to}`);
    console.error(`Hours since last email: ${hoursSinceLastEmail}`);
    console.error('');
    console.error('To re-enable email sending:');
    console.error(`  chmod +w ${LOGS_DIR} && rm ${ABORT_FILE}`);
    console.error('');
    process.exit(1);
  }

  // Safety check: Duplicate detection (same recipient + subject)
  if (lastEmail.to === to && lastEmail.subject === subject) {
    createAbortFlag(
      'DUPLICATE_DETECTED',
      'Attempted to send duplicate email with same recipient and subject',
      { to, subject, timestamp: new Date().toISOString() },
      { to: lastEmail.to, subject: lastEmail.subject, timestamp: lastEmail.timestamp }
    );

    console.error('');
    console.error('❌ DUPLICATE EMAIL DETECTED');
    console.error('');
    console.error('The previous email had the same recipient and subject:');
    console.error(`  To: ${to}`);
    console.error(`  Subject: ${subject}`);
    console.error('');
    console.error('To re-enable email sending:');
    console.error(`  chmod +w ${LOGS_DIR} && rm ${ABORT_FILE}`);
    console.error('');
    process.exit(1);
  }
}

// Process attachments
const attachments = [];
for (const attachmentPath of attachmentPaths) {
  if (!fs.existsSync(attachmentPath)) {
    console.error(`Error: Attachment file not found: ${attachmentPath}`);
    process.exit(1);
  }

  attachments.push({
    filename: path.basename(attachmentPath),
    path: attachmentPath
  });
}

// Send the email
(async function sendEmail() {
  try {
    console.log('Sending email...');

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD
      }
    });

    const mailOptions = {
      from: `"${GMAIL_NAME}" <${GMAIL_USER}>`,
      to: to,
      subject: subject,
      text: message,
      attachments: attachments
    };

    if (cc) {
      mailOptions.cc = cc;
    }

    const info = await transporter.sendMail(mailOptions);

    // Log the sent email
    const logEntry = {
      timestamp: new Date().toISOString(),
      from: GMAIL_USER,
      fromAccount: fromAccount,
      to,
      cc: cc || undefined,
      subject,
      messageId: info.messageId,
      attachments: attachments.map(att => att.filename)
    };

    emailLog.push(logEntry);
    fs.writeFileSync(LOG_FILE, JSON.stringify(emailLog, null, 2));

    console.log('✓ Email sent successfully!');
    console.log(`  From: ${GMAIL_NAME} <${GMAIL_USER}>`);
    console.log(`  To: ${to}`);
    if (cc) {
      console.log(`  CC: ${cc}`);
    }
    console.log(`  Subject: ${subject}`);
    console.log(`  Message ID: ${info.messageId}`);
    console.log(`  Logged to: ${LOG_FILE}`);

  } catch (error) {
    console.error('\nError sending email:', error.message);

    if (error.code === 'EAUTH') {
      console.error('');
      console.error('Authentication failed. Please check:');
      console.error(`1. Your email address is correct: ${GMAIL_USER}`);
      console.error('2. You are using an App Password (not your regular password)');
      console.error('3. 2FA is enabled on your Google account');
      console.error('');
      console.error('Get an App Password: https://myaccount.google.com/apppasswords');
    }

    process.exit(1);
  }
})();
