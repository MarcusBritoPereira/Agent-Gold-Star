const crypto = require('crypto');

// Instead of sqlite3 package which might not be installed on host, we can pass the data string as an argument
const encryptedBase64 = "U2FsdGVkX1+OcOTsYRR1d2wMoO1KCuqGZ1+PemVHGaDdR7wad66ZuAorj36yNbf11MJ+EEQS5GRbjwasCtoFB0r/BIT8tPA/ZlWFSjbqDsC5/+BMviiKeRGtJYkE2jWl80gfyQsuTsgesmoDQrlKxvO8MxoT6uE0pZ5QppofYU+OeV/5XBU2lUL6b81ac8/q/9ZipWhg+j+mO0eMIflLcw==";
const encryptionKey = "WDRourIIUv2BVVI6f+PZykUqTi96NnsA";

function decrypt(ciphertextBase64, password) {
  const ciphertext = Buffer.from(ciphertextBase64, 'base64');
  
  // OpenSSL "Salted__" format: [8 bytes "Salted__"][8 bytes salt][ciphertext]
  if (ciphertext.slice(0, 8).toString('ascii') !== 'Salted__') {
    throw new Error('Invalid salt header');
  }
  
  const salt = ciphertext.slice(8, 16);
  const data = ciphertext.slice(16);
  
  // Derive key and IV using OpenSSL EVP_BytesToKey (md5)
  // n8n derives key (32 bytes) and iv (16 bytes) from password and salt
  let derived = Buffer.alloc(0);
  let currentHash = Buffer.alloc(0);
  
  while (derived.length < 48) {
    const hasher = crypto.createHash('md5');
    hasher.update(currentHash);
    hasher.update(password, 'utf8');
    hasher.update(salt);
    currentHash = hasher.digest();
    derived = Buffer.concat([derived, currentHash]);
  }
  
  const key = derived.slice(0, 32);
  const iv = derived.slice(32, 48);
  
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(data);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  return decrypted.toString('utf8');
}

try {
  const decryptedText = decrypt(encryptedBase64, encryptionKey);
  console.log("DECRYPTED CREDENTIAL DATA:");
  console.log(decryptedText);
} catch (err) {
  console.error("Decryption failed:", err);
}
