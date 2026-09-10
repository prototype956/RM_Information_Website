import { randomBytes } from "node:crypto";

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function createInvitationCode() {
  return Array.from(randomBytes(12), (byte) => alphabet[byte & 31]).join("");
}

export function normalizeInvitationCode(value) {
  if (typeof value !== "string") return "";
  const code = value.trim();
  return /^[a-f\d]{48}$/i.test(code) ? code.toLowerCase() : code.toUpperCase();
}
