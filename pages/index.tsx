export default function Index() {
  return null;
}

export async function getServerSideProps() {
  return {
    redirect: {
      destination: "/api/not-found",
      permanent: false,
    },
  };
}
