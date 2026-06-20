module.exports = {
  launch: async () => ({
    newPage: async () => ({
      setContent: async () => {},
      pdf: async () => Buffer.from('mock-pdf-content'),
    }),
    close: async () => {},
  }),
};
