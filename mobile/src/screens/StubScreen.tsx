import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  body: string;
  title: string;
};

export function StubScreen({ title, body }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top + 24 }]}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      <Text style={styles.note}>
        Milestone A shell — domain UI arrives after the native camera go/no-go gate
        (Milestone B).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: '#A8B3C7',
    fontSize: 15,
    lineHeight: 22,
  },
  note: {
    color: '#6E7B91',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 16,
  },
  root: {
    backgroundColor: '#0B1220',
    flex: 1,
    gap: 10,
    paddingHorizontal: 20,
  },
  title: {
    color: '#F4F7FB',
    fontSize: 28,
    fontWeight: '700',
  },
});
