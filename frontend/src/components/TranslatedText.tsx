import { Fragment, type ReactNode } from 'react';
import { useI18n, type MessageId, type MessageParameters } from '../i18n';

/** Complete translated sentences with React emphasis; neither catalogs nor slots contain HTML. */
export function TranslatedText({
  messageId,
  parameters = {},
  slots,
}: {
  messageId: MessageId;
  parameters?: MessageParameters;
  slots: Readonly<Record<string, ReactNode>>;
}) {
  const { t } = useI18n();
  const tokens: Record<string, ReactNode> = Object.create(null);
  const values: Record<string, string | number> = { ...parameters };
  Object.entries(slots).forEach(([name, node], index) => {
    const token = `\uFFF0slot${index}\uFFF1`;
    tokens[token] = node;
    values[name] = token;
  });
  return t(messageId, values)
    .split(/(\uFFF0slot\d+\uFFF1)/u)
    .map((part, index) => (
      <Fragment key={index}>{Object.hasOwn(tokens, part) ? tokens[part] : part}</Fragment>
    ));
}
