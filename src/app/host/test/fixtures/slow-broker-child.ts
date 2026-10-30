import { writeFileSync } from "node:fs";
import { join } from "node:path";
writeFileSync(join(process.env.OHQUANT_DIR!, "child-pid"), String(process.pid));
setInterval(() => {}, 1000);
