export interface ColorConfig {
  name: string;
  value: string;
  opacity?: number;
}

export interface WidgetTheme {
  id: string;
  name: string;
  is_default: boolean;
  bg_color: string;
  bg_opacity: number;
  text_colors: ColorConfig[];
  primary_colors: ColorConfig[];
  widget_scope?: string;
}

export interface WidgetThemeConfig {
  themes: WidgetTheme[];
  assignments: Record<string, string>;
}
