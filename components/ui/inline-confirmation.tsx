interface ConfirmationDialogProps {
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
}

function ConfirmationDialog({
  title,
  description,
  onConfirm,
  onCancel,
  confirmText = "Continue",
  cancelText = "Cancel",
}: ConfirmationDialogProps) {
  return (
    <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3">
      <p className="text-sm text-yellow-800">{title}</p>
      <p className="mt-1 text-xs text-yellow-700">{description}</p>
      <div className="mt-2 flex gap-2">
        <button
          className="rounded-md bg-yellow-100 px-4 py-2 text-sm font-medium text-yellow-900 hover:bg-yellow-200"
          type="button"
          onClick={(e) => {
            e?.stopPropagation?.();
            onConfirm();
          }}
        >
          {confirmText}
        </button>
        <button
          className="rounded-md px-4 py-2 text-sm text-yellow-900 hover:bg-yellow-100"
          type="button"
          onClick={(e) => {
            e?.stopPropagation?.();
            onCancel();
          }}
        >
          {cancelText}
        </button>
      </div>
    </div>
  );
}

export default ConfirmationDialog;
