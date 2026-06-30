import html
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from anyio import to_thread
from loguru import logger

from app.core.config import get_settings

# Abort a hung SMTP connection rather than blocking a worker thread forever.
_SMTP_TIMEOUT_SECONDS = 10

settings = get_settings()


async def send_password_reset_email(
    to_email: str,
    to_name: str,
    raw_token: str,
) -> None:
    """
    Sends the password reset email containing the one-time token link.

    In development (DEBUG=True), skips actual sending and logs the link
    to the console — no SMTP setup needed for local dev.

    In production, uses SMTP with STARTTLS.
    """
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={raw_token}"

    if settings.DEBUG:
        logger.info(
            f"[DEV] Password reset link for {to_email}:\n{reset_url}\n"
            "(Email not sent — DEBUG=True)"
        )
        return

    subject = f"Reset your {settings.APP_NAME} password"
    # HTML-escape the user-controlled name to prevent HTML/markup injection into
    # the rendered email body.
    safe_name = html.escape(to_name or "")
    html_body = _build_reset_email_html(safe_name, reset_url)
    text_body = _build_reset_email_text(to_name, reset_url)

    def _send() -> None:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{settings.EMAIL_FROM_NAME} <{settings.EMAIL_FROM}>"
        msg["To"] = to_email

        msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=_SMTP_TIMEOUT_SECONDS) as server:
            server.ehlo()
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.EMAIL_FROM, to_email, msg.as_string())

    try:
        # smtplib is blocking — run it in a worker thread so it never stalls the
        # event loop, even though this is invoked from an async background task.
        await to_thread.run_sync(_send)
        logger.info(f"Password reset email sent to {to_email}")
    except Exception as exc:
        logger.error(f"Failed to send password reset email to {to_email}: {exc}")
        # Do not re-raise — email failure must not expose internal errors to the user.
        # The forgot-password endpoint always returns 200 regardless.


def _build_reset_email_text(name: str, reset_url: str) -> str:
    return (
        f"Hi {name},\n\n"
        f"You requested a password reset for your {settings.APP_NAME} account.\n\n"
        f"Click the link below to reset your password (valid for 15 minutes):\n"
        f"{reset_url}\n\n"
        f"If you did not request this, please ignore this email.\n\n"
        f"— The {settings.APP_NAME} Team"
    )


def _build_reset_email_html(name: str, reset_url: str) -> str:
    return f"""
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1976D2;">Password Reset Request</h2>
        <p>Hi {name},</p>
        <p>You requested a password reset for your <strong>{settings.APP_NAME}</strong> account.</p>
        <p>Click the button below to reset your password. This link is valid for <strong>15 minutes</strong>.</p>
        <a href="{reset_url}"
           style="display:inline-block; padding:12px 24px; background:#1976D2;
                  color:#fff; text-decoration:none; border-radius:4px; margin:16px 0;">
            Reset Password
        </a>
        <p>Or copy this link into your browser:</p>
        <p style="word-break:break-all; color:#555;">{reset_url}</p>
        <hr style="border:none; border-top:1px solid #eee; margin:24px 0;">
        <p style="color:#888; font-size:12px;">
            If you did not request a password reset, please ignore this email.
            Your password will not be changed.
        </p>
    </body>
    </html>
    """
