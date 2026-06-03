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

    </Box>
  );
}
