using System.Runtime.CompilerServices;

// Lets the catalogue-completeness test assert the display-name-key
// convention (ContractOfferScreenModelFactory.ContractDisplayNameKey /
// .TraitDisplayNameKey) actually agrees with what content authors, and lets
// it check the screen's own title key — see the remarks on those two
// methods and on ContractOfferScreenModelFactory.TitleKey. Nothing else in
// this assembly is internal for the test project's sake; this exists solely
// so an invisible naming convention has a visible detector.
[assembly: InternalsVisibleTo("OathAndCoin.Presentation.Tests")]
