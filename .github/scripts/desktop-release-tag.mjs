import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function verifyReleaseTag(version, sha, readRefs) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{40}$/.test(sha ?? ""))
    throw new Error("A stable version and exact tested commit are required");
  const tag = `refs/tags/v${version}`;
  // ls-remote succeeds with empty output for a missing tag; lookup failures must throw.
  const byName = new Map(readRefs(tag).trim().split("\n").filter(Boolean).map(line => {
    const [hash, name, extra] = line.trim().split(/\s+/);
    if (!/^[a-f0-9]{40}$/.test(hash) || ![tag, `${tag}^{}`].includes(name) || extra)
      throw new Error("Unexpected release tag lookup result");
    return [name, hash];
  }));
  const target = byName.get(`${tag}^{}`) ?? byName.get(tag);
  if (target && target !== sha)
    throw new Error(`Release v${version} resolves to ${target}, but the tested build is ${sha}. Choose a new version or obtain explicit approval to correct an unpublished tag.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { version } = JSON.parse(readFileSync("apps/desktop/package.json", "utf8"));
  verifyReleaseTag(version, process.env.GITHUB_SHA, tag =>
    execFileSync("git", ["ls-remote", "origin", tag, `${tag}^{}`], { encoding: "utf8" }));
}
