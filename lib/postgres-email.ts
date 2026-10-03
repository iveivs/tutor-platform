import "server-only";

import nodemailer from "nodemailer";

function smtpConfig() {
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = process.env.SMTP_SECURE === "true";
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM;
  if (!host || !user || !pass || !from || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return { host, port, secure, auth: { user, pass }, from };
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

async function deliver(email: string, subject: string, heading: string, body: string, url: string, button: string) {
  const config = smtpConfig();
  if (!config) return false;
  try {
    const safeHeading = escapeHtml(heading);
    const safeBody = escapeHtml(body);
    const safeUrl = escapeHtml(url);
    const safeButton = escapeHtml(button);
    const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, auth: config.auth });
    await transport.sendMail({
      from: config.from,
      to: email,
      subject,
      text: `${heading}\n\n${body}\n\n${button}: ${url}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111827"><h1 style="font-size:24px">${safeHeading}</h1><p style="line-height:1.6">${safeBody}</p><p><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600">${safeButton}</a></p><p style="font-size:12px;color:#6b7280">Если кнопка не открывается, скопируйте ссылку: ${safeUrl}</p></div>`,
    });
    return true;
  } catch (error) {
    console.error(JSON.stringify({ event: "smtp_delivery_failed", reason: error instanceof Error ? error.name : "unknown" }));
    return false;
  }
}

export function sendTeacherInvitation(email: string, name: string, url: string) {
  return deliver(email, "Приглашение в Tutor Platform", `Здравствуйте, ${name}!`, "Администратор создал для вас персональный кабинет преподавателя. Ссылка действует 14 дней и может быть использована один раз.", url, "Создать кабинет");
}

export function sendStudentInvitation(email: string, name: string, url: string) {
  return deliver(email, "Доступ к кабинету ученика", `Здравствуйте, ${name}!`, "Преподаватель пригласил вас в личный кабинет. Ссылка действует 14 дней и может быть использована один раз.", url, "Открыть кабинет");
}

export function sendPasswordRecovery(email: string, name: string, url: string) {
  return deliver(email, "Восстановление пароля Tutor Platform", `Здравствуйте, ${name}!`, "По вашему адресу запросили новый пароль. Ссылка действует один час. Если это были не вы, письмо можно проигнорировать.", url, "Задать новый пароль");
}
