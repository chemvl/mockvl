import { createStyles } from 'antd-style';

export const useEditorStyles = createStyles(({ token, css }) => ({
  root: css`
    border: 1px solid ${token.colorBorder};
    border-radius: ${token.borderRadius}px;
    background: ${token.colorBgContainer};
    transition: border-color ${token.motionDurationMid};

    &:focus-within {
      border-color: ${token.colorPrimary};
      box-shadow: 0 0 0 2px ${token.controlOutline};
    }
  `,
  rootDisabled: css`
    background: ${token.colorBgContainerDisabled};
    color: ${token.colorTextDisabled};

    &:focus-within {
      border-color: ${token.colorBorder};
      box-shadow: none;
    }
  `,
  toolbar: css`
    border-bottom: 1px solid ${token.colorBorderSecondary};
    padding: 4px 8px;
  `,
  content: css`
    .ProseMirror {
      min-height: 200px;
      padding: 8px 12px;
      outline: none;

      p {
        margin: 0 0 0.5em;
      }

      /* The app-level CSS reset strips list markers — restore them here. */
      ul,
      ol {
        padding-left: 1.5em;
        margin: 0.5em 0;
      }

      ul {
        list-style: disc;
      }

      ol {
        list-style: decimal;
      }

      blockquote {
        margin: 0.5em 0;
        padding-left: 12px;
        border-left: 3px solid ${token.colorBorderSecondary};
        color: ${token.colorTextSecondary};
      }

      pre {
        background: ${token.colorFillTertiary};
        border-radius: ${token.borderRadiusSM}px;
        padding: 12px;
        font-family: ${token.fontFamilyCode};
        font-size: ${token.fontSizeSM}px;
      }

      code {
        font-family: ${token.fontFamilyCode};
      }

      img {
        max-width: 100%;
        height: auto;
      }

      table {
        border-collapse: collapse;
        width: 100%;
        margin: 0.5em 0;

        th,
        td {
          border: 1px solid ${token.colorBorderSecondary};
          padding: 4px 8px;
          vertical-align: top;
        }

        th {
          background: ${token.colorFillQuaternary};
          text-align: left;
        }
      }
    }
  `,
  sourceTextarea: css`
    font-family: ${token.fontFamilyCode};
    font-size: ${token.fontSizeSM}px;
  `,
}));
