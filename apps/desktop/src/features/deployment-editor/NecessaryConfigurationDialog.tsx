import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import {
  isMissingConfigurationValue,
  parseConfigurationDocument,
  updateConfigurationDocument,
} from "./configuration-document";

interface NecessaryConfigurationDialogProps {
  content: string;
  onCancel: () => void;
  onSave: (content: string) => void;
  open: boolean;
  requiredVariables: readonly string[];
}

export function NecessaryConfigurationDialog({
  content,
  onCancel,
  onSave,
  open,
  requiredVariables,
}: NecessaryConfigurationDialogProps) {
  const id = useId();
  const requiredSignature = requiredVariables.join("\u0000");
  const fields = useMemo(
    () => parseConfigurationDocument(content, requiredVariables),
    // The signature prevents a parent-created array from resetting this form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [content, requiredSignature],
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    valuesFromFields(fields),
  );
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(() => new Set());
  const [initialMissingKeys, setInitialMissingKeys] = useState<Set<string>>(
    () => missingKeys(fields, valuesFromFields(fields)),
  );
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!open) return;
    const nextValues = valuesFromFields(fields);
    setValues(nextValues);
    setDirtyKeys(new Set());
    setInitialMissingKeys(missingKeys(fields, nextValues));
    setShowAll(false);
  }, [content, fields, open, requiredSignature]);

  const missing = missingKeys(fields, values);
  const visibleFields = showAll
    ? fields
    : fields.filter(
        (field) =>
          field.required &&
          (initialMissingKeys.has(field.key) || missing.has(field.key)),
      );

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
      open={open}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>补全本次上线配置</DialogTitle>
          <DialogDescription>
            {missing.size > 0
              ? `本次上线还需填写 ${missing.size} 项；其他配置不会阻塞本次上线。`
              : "本次上线需要的配置已填写完整。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex justify-end">
            <Button
              onClick={() => setShowAll((current) => !current)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {showAll ? "只看本次待填写" : "查看其他配置"}
            </Button>
          </div>

          {visibleFields.length > 0 ? (
            <div className="space-y-4">
              {visibleFields.map((field) => {
                const inputId = `${id}-${field.key}`;
                const keyId = `${inputId}-key`;
                const hasKeySubtitle = field.title !== field.key;
                return (
                  <div className="space-y-1.5" key={field.key}>
                    <label
                      className="block text-sm font-medium"
                      htmlFor={inputId}
                    >
                      {field.title}
                    </label>
                    {hasKeySubtitle ? (
                      <div
                        className="font-mono text-xs text-[var(--muted-foreground)]"
                        id={keyId}
                      >
                        {field.key}
                      </div>
                    ) : null}
                    <Input
                      aria-describedby={hasKeySubtitle ? keyId : undefined}
                      aria-label={field.title}
                      autoComplete={field.secret ? "new-password" : "off"}
                      id={inputId}
                      onChange={(event) => {
                        const value = event.target.value;
                        setValues((current) => ({
                          ...current,
                          [field.key]: value,
                        }));
                        setDirtyKeys((current) => {
                          const next = new Set(current);
                          next.add(field.key);
                          return next;
                        });
                      }}
                      type={field.secret ? "password" : "text"}
                      value={values[field.key] ?? ""}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="m-0 rounded-lg bg-[var(--muted)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
              本次上线没有待填写的配置。
            </p>
          )}
        </div>

        <DialogFooter>
          <Button onClick={onCancel} type="button" variant="secondary">
            取消
          </Button>
          <Button
            disabled={missing.size > 0}
            onClick={() => {
              const updates: Record<string, string> = {};
              fields.forEach((field) => {
                if (dirtyKeys.has(field.key)) {
                  updates[field.key] = values[field.key] ?? "";
                }
              });
              onSave(updateConfigurationDocument(content, updates));
            }}
            type="button"
          >
            保存并继续上线
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function valuesFromFields(
  fields: ReturnType<typeof parseConfigurationDocument>,
) {
  return Object.fromEntries(fields.map((field) => [field.key, field.value]));
}

function missingKeys(
  fields: ReturnType<typeof parseConfigurationDocument>,
  values: Readonly<Record<string, string>>,
) {
  return new Set(
    fields
      .filter(
        (field) =>
          field.required &&
          isMissingConfigurationValue(values[field.key] ?? ""),
      )
      .map((field) => field.key),
  );
}
