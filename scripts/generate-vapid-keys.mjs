// Prints a new VAPID key pair as .env lines. Append to the env file without echoing it:
//   node scripts/generate-vapid-keys.mjs >> .env
// Rotating the keys invalidates every existing push subscription.
import { generateVapidKeys } from "./web-push.mjs";

const { publicKey, privateKey } = generateVapidKeys();
process.stdout.write(`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\n`);
