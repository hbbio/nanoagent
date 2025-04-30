import { type Content, textIncludes } from "./content";
import { type Message, SystemMessage, UserMessage } from "./message";
import type { ChatModel } from "./model";

export const lastMessageIncludes =
  (text: string, options?: { caseInsensitive?: boolean }) =>
  async ({ messages }: { messages: readonly Message[] }) => {
    if (!messages?.length) return false;
    const last = messages[messages.length - 1];
    if (!last?.content) return false;
    return textIncludes(last.content, text, options);
  };

const UserInputGuidelines = `Does the following message explicitly require the user to respond with a decision, confirmation, or additional instructions?

Reply 'yes' if:
- The message asks a question ending with a question mark '?' that expects a real user answer.
- The message offers to do something ("Should I...", "Would you like me to...", "Can I...") and waits for the user's decision.
- The message proposes multiple options and asks the user to choose or confirm.

Reply 'no' if:
- The message only reports completed actions, statuses, or results, without asking anything.
- The message provides summaries, outcomes, or information, but does not propose future actions or request guidance.

Important:  
If the message sounds like an offer or suggestion, assume it requires input and reply 'yes'.  
If the message only describes the past or current state without asking anything, reply 'no'.

Always reply exactly 'yes' or 'no'. No explanations.`;

const WantsToExitGuidelines = `Does the following message specifically wants to end the conversation? Reply 'yes' and nothing else when the last message of the assistant is asking to exit, or end the conversation otherwise. 

In all other cases, reply 'no' and nothing else.`;

/**
 * answerIsYes asks about simple yes/no tasks to smaller models.
 */
export const answerIsYes =
  (guidelines: string, model: ChatModel) =>
  async (content: string | Content | null) => {
    if (!content) throw new Error("no content");
    const { messages } = await model.complete([
      SystemMessage(guidelines),
      UserMessage(content)
    ]);
    // console.log("answerIsYes", { messages });
    return lastMessageIncludes("yes", { caseInsensitive: true })({
      messages
    });
  };

export const requestsUserInput = (model: ChatModel) =>
  answerIsYes(UserInputGuidelines, model);
export const wantsToExit = (model: ChatModel) =>
  answerIsYes(WantsToExitGuidelines, model);
