import { Checkbox } from "@/components/ds";
import styles from "./BehaviorFields.module.scss";

type ResponseMode = "static" | "dynamic";

type ResponsesFieldProps = {
  name: string;
  value: ResponseMode;
  onChange: (value: ResponseMode) => void;
  disabled?: boolean;
};

export function ResponsesField({ name, value, onChange, disabled = false }: ResponsesFieldProps) {
  return (
    <div className={styles.group}>
      <span className={styles.title}>Responses</span>
      <Checkbox
        type="radio"
        name={name}
        checked={value === "static"}
        disabled={disabled}
        onChange={() => onChange("static")}
        label="Static — use examples from the schema"
      />
      <Checkbox
        type="radio"
        name={name}
        checked={value === "dynamic"}
        disabled={disabled}
        onChange={() => onChange("dynamic")}
        label="Dynamic — generate fake data from response schemas"
      />
    </div>
  );
}

type RequestsFieldProps = {
  validateRequests: boolean;
  cors: boolean;
  onChange: (patch: { validateRequests?: boolean; cors?: boolean }) => void;
  disabled?: boolean;
  showValidation?: boolean;
};

export function RequestsField({
  validateRequests,
  cors,
  onChange,
  disabled = false,
  showValidation = true,
}: RequestsFieldProps) {
  return (
    <div className={styles.group}>
      <span className={styles.title}>Requests</span>
      {showValidation && (
        <Checkbox
          checked={validateRequests}
          disabled={disabled}
          onChange={(event) => onChange({ validateRequests: event.target.checked })}
          label="Return 422 with details when a request doesn't match the schema"
        />
      )}
      <Checkbox
        checked={cors}
        disabled={disabled}
        onChange={(event) => onChange({ cors: event.target.checked })}
        label="Allow cross-origin requests (CORS)"
      />
    </div>
  );
}
