// Prism's request validator with comma lists in path parameters fixed.
//
// validateInput re-parses the path with an RFC 6570 template
// (uri-template-lite), which turns `a,b` into ["a", "b"] before Prism's own
// style deserializers run. Those expect a string: array schemas throw
// (`value.split is not a function` → 500), and string schemas get a false
// 422. Percent-encoding commas inside templated segments makes the template
// match return the decoded string "a,b", which Prism then splits per the
// parameter's style. Only validation sees the encoded copy: prism-core uses
// validateInput's diagnostics and discards the element it returns.
//
// Internal path: prism-http has no `exports` map; pinned by
// prism-http@5.16.0 — re-check on any upgrade.
import { validateInput } from "@stoplight/prism-http/dist/validator";

const PARAM = /\{[^}]+\}/g;

// Prism's router matches segment by segment with equal counts, so segment i
// of a routed path lines up with segment i of its template. Segments whose
// template has a literal comma (`/a,b/{id}`) are left alone so they still
// match.
function encodeParamCommas(path: string, template: string): string {
  const templateSegments = template.split("/");
  return path
    .split("/")
    .map((segment, i) => {
      const templateSegment = templateSegments[i];
      const encode =
        templateSegment?.includes("{") && !templateSegment.replace(PARAM, "").includes(",");
      return encode ? segment.replaceAll(",", "%2C") : segment;
    })
    .join("/");
}

export const commaSafeValidateInput: typeof validateInput = ({ resource, element }) =>
  validateInput({
    resource,
    element: {
      ...element,
      url: { ...element.url, path: encodeParamCommas(element.url.path, resource.path) },
    },
  });
