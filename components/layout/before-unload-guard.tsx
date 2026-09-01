// "use client";

// import { useEffect } from "react";

// export default function BeforeUnloadGuard() {
//   useEffect(() => {
//     const handleBeforeUnload = (event: BeforeUnloadEvent) => {
//       // This works on desktop browsers
//       event.preventDefault();
//     };

//     const handlePageHide = (event: PageTransitionEvent) => {
//       // This works better on iOS Safari
//       // Note: You can't show confirmation dialogs here
//       // But you can trigger cleanup or save operations
//       if (!event.persisted) {
//         // Page is being unloaded (not going to back/forward cache)
//         // Perform any necessary cleanup here
//       }
//     };

//     // Add both listeners for broader compatibility
//     window.addEventListener("beforeunload", handleBeforeUnload);
//     window.addEventListener("pagehide", handlePageHide);

//     return () => {
//       window.removeEventListener("beforeunload", handleBeforeUnload);
//       window.removeEventListener("pagehide", handlePageHide);
//     };
//   }, []);

//   return null;
// }
