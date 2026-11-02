export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null | any[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface ComputerUseAction {
  type: 'click' | 'double_click' | 'triple_click' | 'middle_click' | 'right_click' | 'press_mouse_button' | 'mouse_up' | 'move' | 'type' | 'drag' | 'sleep' | 'key' | 'key_press' | 'key_up' | 'hotkey' | 'take_screenshot' | 'scroll';
  x?: number;
  y?: number;
  text?: string;
  keys?: string[];
  key?: string;
  button?: 'left' | 'right' | 'middle';
  scroll_x?: number;
  scroll_y?: number;
  ms?: number;
}

export interface ComputerUseResponse {
  id: string;
  callId?: string;
  responseId?: string;
  actions: ComputerUseAction[];
  pendingSafetyChecks?: Array<{ id: string; code?: string; message?: string }>;
  explanation?: string;
  raw?: any;
}
