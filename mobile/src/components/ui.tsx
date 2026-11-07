import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { ComponentProps, ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Hazard, hazardById } from '@/lib/hazards';
import { color, font, radius, space, type } from '@/lib/theme';

type IonName = ComponentProps<typeof Ionicons>['name'];

// ---------- Text ----------

type TProps = {
  v?: keyof typeof type;
  c?: string;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
};
export function T({ v = 'body', c = color.ink, style, children, numberOfLines }: TProps) {
  return (
    <Text style={[type[v], { color: c }, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

// ---------- Screen ----------

export function Screen({
  children,
  title,
  subtitle,
  right,
  scroll = true,
  bg = color.paper,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  scroll?: boolean;
  bg?: string;
}) {
  const header = title ? (
    <View style={s.screenHeader}>
      <View style={{ flex: 1 }}>
        <T v="title">{title}</T>
        {subtitle ? (
          <T v="small" c={color.inkSoft} style={{ marginTop: 2 }}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {right}
    </View>
  ) : null;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: bg }}>
      {scroll ? (
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          {header}
          {children}
        </ScrollView>
      ) : (
        <View style={[s.scroll, { flex: 1 }]}>
          {header}
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

// ---------- Buttons ----------

type BtnKind = 'primary' | 'secondary' | 'ghost' | 'ghostLight' | 'safe' | 'inverse';
export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  style,
  big,
}: {
  label: string;
  onPress?: () => void;
  kind?: BtnKind;
  icon?: IonName;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  big?: boolean;
}) {
  const palette: Record<BtnKind, { bg: string; fg: string; border?: string }> = {
    primary: { bg: color.red, fg: color.white },
    secondary: { bg: color.white, fg: color.ink, border: color.line },
    ghost: { bg: 'transparent', fg: color.red },
    ghostLight: { bg: 'transparent', fg: color.white },
    safe: { bg: color.safe, fg: color.white },
    inverse: { bg: color.white, fg: color.redDeep },
  };
  const p = palette[kind];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        big && s.btnBig,
        { backgroundColor: p.bg, borderColor: p.border ?? p.bg, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
        (kind === 'ghost' || kind === 'ghostLight') && { borderColor: 'transparent' },
        style,
      ]}>
      {icon ? <Ionicons name={icon} size={big ? 22 : 18} color={p.fg} /> : null}
      <T v={big ? 'heading' : 'bodyStrong'} c={p.fg}>
        {label}
      </T>
    </Pressable>
  );
}

// ---------- Grouped list ----------

export function Section({
  title,
  action,
  children,
  style,
}: {
  title?: string;
  action?: { label: string; onPress: () => void };
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ marginTop: space.xl }, style]}>
      {title ? (
        <View style={s.sectionHead}>
          <T v="heading">{title}</T>
          {action ? (
            <Pressable onPress={action.onPress} hitSlop={10} accessibilityRole="button">
              <T v="smallStrong" c={color.red}>
                {action.label}
              </T>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={s.group}>{children}</View>
    </View>
  );
}

export function Row({
  icon,
  hazard,
  label,
  value,
  placeholder,
  onPress,
  last,
  right,
  tone,
}: {
  icon?: IonName;
  hazard?: Hazard;
  label: string;
  value?: string;
  placeholder?: string;
  onPress?: () => void;
  last?: boolean;
  right?: ReactNode;
  tone?: 'danger';
}) {
  const empty = !value && placeholder;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [s.row, !last && s.rowDivider, pressed && onPress && { backgroundColor: color.paper }]}>
      {hazard ? <HazardBadge hazard={hazard} muted={!!empty} /> : null}
      {icon ? (
        <View style={s.rowIcon}>
          <Ionicons name={icon} size={20} color={tone === 'danger' ? color.red : color.ink} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <T v={value || empty ? 'small' : 'bodyStrong'} c={value || empty ? color.inkSoft : tone === 'danger' ? color.red : color.ink}>
          {label}
        </T>
        {value ? <T v="bodyStrong">{value}</T> : null}
        {empty ? (
          <T v="bodyStrong" c={color.red}>
            {placeholder}
          </T>
        ) : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={color.inkSoft} /> : null)}
    </Pressable>
  );
}

export function ToggleRow({
  label,
  detail,
  value,
  onChange,
  last,
}: {
  label: string;
  detail?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <View style={[s.row, !last && s.rowDivider]}>
      <View style={{ flex: 1, paddingRight: space.md }}>
        <T v="bodyStrong">{label}</T>
        {detail ? (
          <T v="small" c={color.inkSoft}>
            {detail}
          </T>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: color.red, false: color.line }} thumbColor={color.white} ios_backgroundColor={color.line} />
    </View>
  );
}

// ---------- Hazard badge ----------

export function HazardBadge({ hazard, muted, size = 40 }: { hazard: Hazard; muted?: boolean; size?: number }) {
  const h = hazardById(hazard);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.sm,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: muted ? color.paper : color.redTint,
      }}>
      <MaterialCommunityIcons name={h.icon} size={size * 0.55} color={muted ? color.inkSoft : color.red} />
    </View>
  );
}

// ---------- Form ----------

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ marginBottom: space.lg }}>
      <T v="smallStrong" style={{ marginBottom: 6 }}>
        {label}
      </T>
      <TextInput placeholderTextColor="#A39996" style={[s.input, props.multiline && s.inputMulti]} {...props} />
      {hint ? (
        <T v="caption" c={color.inkSoft} style={{ marginTop: 6 }}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

export function Chips({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={s.chips}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable
            key={o}
            onPress={() => onChange(o)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[s.chip, on && { backgroundColor: color.ink, borderColor: color.ink }]}>
            <T v="smallStrong" c={on ? color.white : color.ink}>
              {o}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stepper({ label, value, onChange, last }: { label: string; value: number; onChange: (n: number) => void; last?: boolean }) {
  return (
    <View style={[s.row, !last && s.rowDivider]}>
      <T v="bodyStrong" style={{ flex: 1 }}>
        {label}
      </T>
      <Pressable
        accessibilityLabel={`Fewer ${label}`}
        onPress={() => onChange(Math.max(0, value - 1))}
        style={s.stepBtn}
        hitSlop={6}>
        <Ionicons name="remove" size={18} color={color.ink} />
      </Pressable>
      <T v="heading" style={{ width: 36, textAlign: 'center' }}>
        {value}
      </T>
      <Pressable accessibilityLabel={`More ${label}`} onPress={() => onChange(value + 1)} style={s.stepBtn} hitSlop={6}>
        <Ionicons name="add" size={18} color={color.ink} />
      </Pressable>
    </View>
  );
}

// ---------- Modal-style sheet header ----------

export function SheetHeader({ title, onCancel, onSave, saveLabel = 'Save', canSave = true }: {
  title: string;
  onCancel: () => void;
  onSave?: () => void;
  saveLabel?: string;
  canSave?: boolean;
}) {
  return (
    <View style={s.sheetHeader}>
      <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button">
        <T v="body" c={color.inkSoft}>
          Cancel
        </T>
      </Pressable>
      <T v="bodyStrong">{title}</T>
      {onSave ? (
        <Pressable onPress={onSave} disabled={!canSave} hitSlop={10} accessibilityRole="button">
          <T v="bodyStrong" c={canSave ? color.red : color.line}>
            {saveLabel}
          </T>
        </Pressable>
      ) : (
        <View style={{ width: 50 }} />
      )}
    </View>
  );
}

export const s = StyleSheet.create({
  scroll: { paddingHorizontal: space.lg, paddingBottom: 48 },
  screenHeader: { flexDirection: 'row', alignItems: 'flex-end', paddingTop: space.md, paddingBottom: space.xs },
  btn: {
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  btnBig: { minHeight: 64, borderRadius: radius.lg },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: space.sm,
    paddingHorizontal: 2,
  },
  group: { backgroundColor: color.white, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 14, minHeight: 56 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  rowIcon: { width: 28, alignItems: 'center' },
  input: {
    backgroundColor: color.white,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: font.regular,
    fontSize: 16,
    color: color.ink,
  },
  inputMulti: { minHeight: 96, textAlignVertical: 'top', paddingTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.white,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
    backgroundColor: color.white,
  },
});
