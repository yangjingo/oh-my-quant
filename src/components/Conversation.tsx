import React from "react";
import { Box, Text } from "ink";
import { Message, type MessageProps } from "./Message.tsx";
import { DIVIDER_CHAR, GOLD, MAIN_WIDTH, SECTION_ACCENT } from "../tui/tokens.ts";

interface ConversationProps {
  messages: MessageProps[];
}

export function Conversation({ messages }: ConversationProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {messages.map((msg, i) => (
        <Message key={msg.id || i} {...msg} />
      ))}

      {/* Recent section */}
      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text color={GOLD}>{SECTION_ACCENT}</Text>
          <Text bold>Recent</Text>
        </Box>
        <Text dimColor>{"  "}{DIVIDER_CHAR.repeat(MAIN_WIDTH)}</Text>
        <Text dimColor>  Momentum scan</Text>
        <Text dimColor>  Factor ranking</Text>
        <Text dimColor>  Backtest CSI300</Text>
      </Box>
    </Box>
  );
}
