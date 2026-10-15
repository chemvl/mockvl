import { Flex, Image, Input } from 'antd';

// FormItem clones its child and injects react-hook-form controller props, so
// everything in `rest` (value/onChange/onBlur/…) must reach the antd Input.
type ImageUrlInputProps = Record<string, any> & {
  value?: unknown;
  disabled?: boolean;
};

// URL text input for "image" fields with a small live preview below it. antd
// Image supplies the broken-src fallback and click-to-zoom; no upload here —
// the field stores a plain URL.
export function ImageUrlInput({ disabled, ...rest }: ImageUrlInputProps) {
  // Edit forms reset with the raw record, so the value can arrive as null.
  const url = typeof rest.value === 'string' ? rest.value : '';

  return (
    <Flex vertical gap={8}>
      <Input
        placeholder="https://…"
        disabled={disabled}
        {...rest}
        value={url}
      />
      {url && (
        <Image
          src={url}
          height={96}
          width={96}
          alt="Preview"
          style={{ height: 96, width: 96, objectFit: 'cover' }}
        />
      )}
    </Flex>
  );
}
