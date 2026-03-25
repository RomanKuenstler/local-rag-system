import crypto from "crypto";
import { AUTH_PASSWORD_SALT } from "../config/index.js";

export function getGlobalPasswordSalt() {
  return String(AUTH_PASSWORD_SALT || "xzy132");
}

export function hashPasswordWithSalt(password, salt) {
  const plainPassword = String(password || "");
  const normalizedSalt = String(salt || "");
  const saltedValue = `${normalizedSalt}${plainPassword}`;
  return crypto.createHash("sha256").update(saltedValue).digest("hex");
}

export function hashPasswordWithGlobalSalt(password) {
  return hashPasswordWithSalt(password, getGlobalPasswordSalt());
}
