import crypto from "crypto";
import { AUTH_PASSWORD_SALT } from "../config/index.js";

export function getGlobalPasswordSalt() {
  return String(AUTH_PASSWORD_SALT || "xzy132");
}

export function hashPasswordWithGlobalSalt(password) {
  const plainPassword = String(password || "");
  const saltedValue = `${getGlobalPasswordSalt()}${plainPassword}`;
  return crypto.createHash("sha256").update(saltedValue).digest("hex");
}
