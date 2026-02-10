import type { ColumnType, Generated } from "kysely";

export interface UsersTable {
  id: Generated<number>;
  line_user_id: string;
  display_name: string | null;
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

export interface Database {
  users: UsersTable;
  groups: GroupsTable;
  chats: ChatsTable;
  chat_messages: ChatMessagesTable;
}
