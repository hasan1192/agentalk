export default function ReceiptTicks({
  double,
  read,
}: {
  double: boolean;
  read: boolean;
}) {
  return (
    <svg
      className={`receipt-icon ${read ? "tick-read" : "tick-delivered"}`}
      width="20"
      height="15"
      viewBox="0 0 24 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-double={double}
    >
      <path d={double ? "M2 9 6 13 16 3" : "M5 9 9 13 19 3"} />
      {double && <path d="m10.5 11.5 1.5 1.5 10-10" />}
    </svg>
  );
}
