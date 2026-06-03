import React from "react";
import { Box, Text, useStdout } from "ink";
import { readLocalUiState } from "../tui/local-state.ts";
import { DIVIDER_CHAR, GOLD } from "../tui/tokens.ts";

export function StatusBar() {
  const { stdout } = useStdout();
  const w = (stdout?.columns ?? 80) - 2;
  const { model, portfolioVariant, portfolioSchemes } = readLocalUiState();
  const activeScheme = portfolioSchemes.find((scheme) => scheme.variant === portfolioVariant);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>{DIVIDER_CHAR.repeat(Math.max(1, w))}</Text>
      <Box>
        <Text dimColor>{model}</Text>
        <Text dimColor> · portfolio </Text>
        {portfolioSchemes.map((scheme, index) => (
          <React.Fragment key={scheme.key}>
            {index > 0 ? <Text dimColor>/</Text> : null}
            <Text color={scheme.key === activeScheme?.key ? GOLD : undefined} dimColor={scheme.key !== activeScheme?.key}>
              {scheme.key}
            </Text>
          </React.Fragment>
        ))}
        <Text dimColor> · </Text>
        <Text color={GOLD}>{activeScheme?.name || portfolioVariant}</Text>
      </Box>
    </Box>
  );
}
