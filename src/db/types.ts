import type { ColumnType, Generated } from "kysely";

export interface UsersTable {
  id: Generated<number>;
  line_user_id: string;
  display_name: string | null;
  score: ColumnType<number, number | undefined, number | undefined>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: ColumnType<
    Date,
    Date | string | undefined,
    Date | string | undefined
  >;
}

export interface ChatsTable {
  id: Generated<number>;
  conversation_id: string;
  source_type: "group" | "room" | "user" | "unknown";
  source_id: string | null;
  group_id: number | null;
  last_message_at: ColumnType<
    Date,
    Date | string | undefined,
    Date | string | undefined
  >;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: ColumnType<
    Date,
    Date | string | undefined,
    Date | string | undefined
  >;
}

export interface ChatMessagesTable {
  id: Generated<number>;
  chat_id: number;
  user_id: number | null;
  text: string;
  sent_at: ColumnType<Date, Date | string | undefined, never>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface GroupsTable {
  id: Generated<number>;
  line_group_id: string;
  group_name: string | null;
  picture_url: string | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: ColumnType<
    Date,
    Date | string | undefined,
    Date | string | undefined
  >;
}

export interface ScheduledMessagesTable {
  id: Generated<number>;
  chat_id: number;
  created_by_user_id: number | null;
  message_text: string;
  message_type: "textV2";
  timezone: string;
  start_at: ColumnType<Date, Date | string | undefined, never>;
  end_at: ColumnType<
    Date,
    Date | string | undefined,
    Date | string | undefined
  >;
  frequency_type: "once" | "daily" | "weekly" | "monthly" | "cron";
  frequency_interval: number | null;
  days_of_week: string | null;
  day_of_month: number | null;
  time_of_day: string | null;
  cron_expression: string | null;
  is_active: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  next_run_at: ColumnType<
    Date,
    Date | string | undefined,
    Date | string | undefined
  >;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: ColumnType<
    Date,
    Date | string | undefined,
    Date | string | undefined
  >;
}

export interface ScheduledMessageSubstitutionsTable {
  id: Generated<number>;
  scheduled_message_id: number;
  key: string;
  type: "mention";
  mentionee_type: "user" | "all" | null;
  user_id: number | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface QuizQuestionsTable {
  id: Generated<number>;
  emoji: string;
  question_text: string;
  generated_at: ColumnType<Date, Date | string | undefined, never>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: ColumnType<
    Date,
    Date | string | undefined,
    Date | string | undefined
  >;
}

export interface QuizChoicesTable {
  id: Generated<number>;
  question_id: number;
  choice_text: string;
  choice_order: number;
  is_correct: ColumnType<boolean, boolean | undefined, boolean | undefined>;
}

export interface QuizAttemptsTable {
  id: Generated<number>;
  question_id: number;
  user_id: number;
  choice_id: number;
  is_correct: boolean;
  answered_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface Database {
  users: UsersTable;
  groups: GroupsTable;
  chats: ChatsTable;
  chat_messages: ChatMessagesTable;
  scheduled_messages: ScheduledMessagesTable;
  scheduled_message_substitutions: ScheduledMessageSubstitutionsTable;
  quiz_questions: QuizQuestionsTable;
  quiz_choices: QuizChoicesTable;
  quiz_attempts: QuizAttemptsTable;
}
