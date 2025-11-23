import os
import smtplib
import logging
from typing import List, Optional, Dict
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders


def _get_env_bool(name: str, default: bool = False) -> bool:
    v = os.environ.get(name)
    if v is None:
        return default
    return str(v).strip().lower() in ["1", "true", "yes", "on"]


def get_smtp_config() -> Dict[str, str]:
    host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    port_str = os.environ.get("SMTP_PORT", "587")
    try:
        port = int(port_str)
    except Exception:
        port = 587
    user = os.environ.get("SMTP_USER") or os.environ.get("GMAIL_USER")
    password = os.environ.get("SMTP_PASS") or os.environ.get("GMAIL_APP_PASSWORD")
    use_tls = _get_env_bool("SMTP_USE_TLS", True)
    use_ssl = _get_env_bool("SMTP_USE_SSL", False)
    default_from = os.environ.get("SMTP_FROM") or user
    return {
        "host": host,
        "port": port,
        "user": user or "",
        "password": password or "",
        "use_tls": use_tls,
        "use_ssl": use_ssl,
        "from": default_from or "",
    }


def send_email(
    to: str,
    subject: str,
    html: Optional[str] = None,
    text: Optional[str] = None,
    cc: Optional[List[str]] = None,
    bcc: Optional[List[str]] = None,
    headers: Optional[Dict[str, str]] = None,
    attachments: Optional[List[Dict[str, str]]] = None,
) -> bool:
    cfg = get_smtp_config()
    if not to or not subject or not (html or text):
        return False
    if not cfg["user"] or not cfg["password"]:
        try:
            logging.getLogger(__name__).warning("SMTP credentials missing: SMTP_USER/GMAIL_USER and SMTP_PASS/GMAIL_APP_PASSWORD are required")
        except Exception:
            pass
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = cfg["from"] or cfg["user"]
    msg["To"] = to
    if cc:
        msg["Cc"] = ", ".join(cc)
    if headers:
        for k, v in headers.items():
            if k and v:
                msg[k] = v

    if text:
        msg.attach(MIMEText(text, "plain", "utf-8"))
    if html:
        msg.attach(MIMEText(html, "html", "utf-8"))

    if attachments:
        for att in attachments:
            path = att.get("path")
            filename = att.get("filename") or (os.path.basename(path) if path else None)
            if not path or not os.path.exists(path):
                continue
            with open(path, "rb") as f:
                part = MIMEBase("application", "octet-stream")
                part.set_payload(f.read())
            encoders.encode_base64(part)
            if filename:
                part.add_header("Content-Disposition", f"attachment; filename={filename}")
            msg.attach(part)

    recipients: List[str] = [to]
    if cc:
        recipients.extend([r for r in cc if r])
    if bcc:
        recipients.extend([r for r in bcc if r])

    try:
        if cfg["use_ssl"]:
            with smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=15) as server:
                server.login(cfg["user"], cfg["password"])
                server.sendmail(msg["From"], recipients, msg.as_string())
        else:
            with smtplib.SMTP(cfg["host"], cfg["port"], timeout=15) as server:
                try:
                    server.ehlo()
                except Exception:
                    pass
                if cfg["use_tls"]:
                    try:
                        server.starttls()
                    except Exception as e:
                        try:
                            logging.getLogger(__name__).warning("SMTP STARTTLS failed: %s", str(e))
                        except Exception:
                            pass
                server.login(cfg["user"], cfg["password"])
                server.sendmail(msg["From"], recipients, msg.as_string())
        return True
    except Exception as e:
        try:
            logging.getLogger(__name__).error("SMTP send failed: %s", str(e))
        except Exception:
            pass
        return False
