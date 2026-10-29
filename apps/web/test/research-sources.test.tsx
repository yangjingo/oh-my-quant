import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Settings } from "../src/components/Settings";
import type { Preferences } from "../src/client/contract";

test("research sources explain daily overview routing and do not request secrets", () => {
  const preferences: Preferences = { model: "test", source: "none", portfolio: "", researchSource: "akshare", researchSources: [
    { id: "akshare", label: "AKShare", requiresCredential: false, credentialConfigured: false },
    { id: "tushare", label: "Tushare", requiresCredential: true, credentialConfigured: false },
    { id: "llmquant-data", label: "LLMQuant", requiresCredential: true, credentialConfigured: true },
    { id: "financial-datasets", label: "Financial Datasets", requiresCredential: true, credentialConfigured: false },
  ] };
  const html = renderToStaticMarkup(<Settings page="source" mode="host" preferences={preferences} setPage={() => {}} onClose={() => {}} onPreferences={async () => {}} snapshot={null} title="test" onRename={async () => {}} fontSize={15} onFontSize={() => {}} onStop={() => {}} />);
  expect(html).toContain('aria-label="研究数据源"'); expect(html).toContain("公开接口，无需密钥");
  expect(html).toContain("需要本机配置凭据"); expect(html).toContain("凭据已配置，待请求验证");
  expect(html).toContain("按源时间显示点位与相对前收涨跌"); expect(html).not.toContain('type="password"');
});
