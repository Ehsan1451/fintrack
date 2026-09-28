const bcrypt = require("bcrypt");

async function main() {
  const { default: prisma } = await import("./src/prisma.ts");

  try {
    const passwordHash = await bcrypt.hash("FinTrackTest2026!", 12);

    await prisma.user.update({
      where: {
        email: "test@fintrack.com",
      },
      data: {
        passwordHash,
      },
    });

    console.log("Password updated successfully.");
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error("Password update failed:", error.message);
    process.exitCode = 1;
  });