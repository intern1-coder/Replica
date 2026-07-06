module.exports = {
  chromium: {
    launch: async () => ({
      isConnected: () => true,
      newPage: async () => ({
        setContent: async () => {},
        pdf: async () => Buffer.from('mock-pdf-content'),
        close: async () => {},
      }),
      close: async () => {},
    }),
  },
};
