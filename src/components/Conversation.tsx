import React from "react";
import { Box, Text } from "ink";
import { Message, type MessageProps } from "./Message.tsx";

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
        <Text dimColor>Recent</Text>
        <Text dimColor>  -Momentum scan</Text>
        <Text dimColor>  -Factor ranking</Text>
        <Text dimColor>  -Backtest CSI300</Text>
      </Box>
    </Box>
  );
}
