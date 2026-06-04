import React from "react";
import { Box, Text } from "ink";
import { Message, type MessageProps } from "./Message.tsx";

interface ConversationProps {
  messages: MessageProps[];
  width?: number;
}

export function Conversation({ messages, width }: ConversationProps) {
  return (
    <Box flexDirection="column" flexGrow={1} marginBottom={1} width={width}>
      {messages.map((msg, i) => (
        <Message key={msg.id || i} {...msg} width={width} />
      ))}

    </Box>
  );
}
