import crypto from "crypto";

const KEY_LENGTH = 64;

export function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

export function verifyPassword(password, passwordHash) {
  return new Promise((resolve, reject) => {
    const [salt, key] = passwordHash.split(":");
    if (!salt || !key) {
      resolve(false);
      return;
    }

    crypto.scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      const storedKey = Buffer.from(key, "hex");
      resolve(storedKey.length === derivedKey.length && crypto.timingSafeEqual(storedKey, derivedKey));
    });
  });
}
